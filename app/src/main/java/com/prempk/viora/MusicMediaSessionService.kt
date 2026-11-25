package com.prempk.viora

import android.app.Notification
import android.app.NotificationChannel
import android.app.Notification.MediaStyle
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * System-control proxy for WebView-owned ordinary music.
 * This service never creates or owns an audio player: WebAudio remains the sole audio path.
 */
class MusicMediaSessionService : Service() {
    private lateinit var session: MediaSession
    private lateinit var manager: NotificationManager
    private val artworkExecutor = Executors.newSingleThreadExecutor()
    private val artworkRequestId = AtomicInteger(0)
    @Volatile private var artworkBitmap: Bitmap? = null
    @Volatile private var currentArtworkUrl = ""
    @Volatile private var artworkLoading = false
    private var currentTitle = "VIORA"
    private var currentArtist = ""
    private var currentAlbum = ""
    private var currentDuration = 0L
    private var currentPlaying = false

    override fun onCreate() {
        super.onCreate()
        manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Music playback", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Playback controls for music playing in VIORA"
                    setShowBadge(false)
                }
            )
        }
        session = MediaSession(this, "VIORA-Music").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = emitAction("play")
                override fun onPause() = emitAction("pause")
                override fun onSkipToNext() = emitAction("next")
                override fun onSkipToPrevious() = emitAction("previous")
                override fun onSeekTo(pos: Long) = emitAction("seek", pos)
            })
            setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS)
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE -> {
                currentTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty().take(160).ifBlank { "VIORA" }
                currentArtist = intent.getStringExtra(EXTRA_ARTIST).orEmpty().take(160)
                currentAlbum = intent.getStringExtra(EXTRA_ALBUM).orEmpty().take(160)
                currentPlaying = intent.getBooleanExtra(EXTRA_PLAYING, false)
                currentDuration = intent.getLongExtra(EXTRA_DURATION, 0L).coerceIn(0L, 86400000L)
                val artworkUrl = intent.getStringExtra(EXTRA_ARTWORK_URL).orEmpty().take(2048)
                publishMetadata()
                publishPlaybackState(currentPlaying)
                startForeground(NOTIFICATION_ID, buildNotification(currentPlaying))
                requestArtwork(artworkUrl)
            }
            ACTION_STATE -> {
                currentPlaying = intent.getBooleanExtra(EXTRA_PLAYING, false)
                publishPlaybackState(currentPlaying)
                if (::session.isInitialized && session.isActive) {
                    manager.notify(NOTIFICATION_ID, buildNotification(currentPlaying))
                }
            }
            ACTION_PLAY -> emitAction("play")
            ACTION_PAUSE -> emitAction("pause")
            ACTION_NEXT -> emitAction("next")
            ACTION_PREVIOUS -> emitAction("previous")
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun publishMetadata(bitmap: Bitmap? = artworkBitmap) {
        val builder = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, currentAlbum)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, currentDuration)
        if (bitmap != null && !bitmap.isRecycled) {
            builder.putBitmap(MediaMetadata.METADATA_KEY_ART, bitmap)
            builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, bitmap)
        }
        session.setMetadata(builder.build())
    }

    private fun requestArtwork(url: String) {
        if (!url.startsWith("https://")) {
            if (currentArtworkUrl.isNotEmpty()) {
                currentArtworkUrl = ""
                artworkRequestId.incrementAndGet()
                artworkBitmap = null
                artworkLoading = false
                publishMetadata(null)
                manager.notify(NOTIFICATION_ID, buildNotification(currentPlaying))
            }
            return
        }
        if (url == currentArtworkUrl && (artworkBitmap != null || artworkLoading)) return
        currentArtworkUrl = url
        artworkBitmap = null
        artworkLoading = true
        val requestId = artworkRequestId.incrementAndGet()
        publishMetadata(null)
        manager.notify(NOTIFICATION_ID, buildNotification(currentPlaying))
        artworkExecutor.execute {
            val bitmap = downloadArtwork(url)
            if (requestId != artworkRequestId.get()) {
                bitmap?.recycle()
                return@execute
            }
            artworkLoading = false
            artworkBitmap = bitmap
            if (bitmap != null && !bitmap.isRecycled && ::session.isInitialized) {
                publishMetadata(bitmap)
                manager.notify(NOTIFICATION_ID, buildNotification(currentPlaying))
            }
        }
    }

    private fun downloadArtwork(source: String): Bitmap? {
        var current = URL(source)
        var redirects = 0
        while (redirects <= 3) {
            if (current.protocol != "https") return null
            val connection = (current.openConnection() as? HttpURLConnection) ?: return null
            connection.connectTimeout = 5000
            connection.readTimeout = 7000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "image/*")
            try {
                val status = connection.responseCode
                if (status in listOf(301, 302, 303, 307, 308)) {
                    val location = connection.getHeaderField("Location") ?: return null
                    current = URL(current, location)
                    redirects++
                    continue
                }
                if (status != HttpURLConnection.HTTP_OK) return null
                val declaredLength = connection.contentLengthLong
                if (declaredLength > MAX_ARTWORK_BYTES) return null
                val bytes = connection.inputStream.use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    var total = 0
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > MAX_ARTWORK_BYTES) return null
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
                val options = BitmapFactory.Options()
                var sample = 1
                while (bounds.outWidth / sample > MAX_ARTWORK_EDGE ||
                    bounds.outHeight / sample > MAX_ARTWORK_EDGE) {
                    sample *= 2
                }
                options.inSampleSize = sample
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            } finally {
                connection.disconnect()
            }
        }
        return null
    }

    private fun publishPlaybackState(playing: Boolean) {
        val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or
            PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(actions)
                .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                .build()
        )
    }

    private fun buildNotification(playing: Boolean): Notification {
        val openApp = PendingIntent.getActivity(
            this, 10, Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val playPause = actionIntent(if (playing) ACTION_PAUSE else ACTION_PLAY, 11)
        val previous = actionIntent(ACTION_PREVIOUS, 12)
        val next = actionIntent(ACTION_NEXT, 13)
        val builder = Notification.Builder(this)
            .setSmallIcon(R.drawable.viora_icon)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist.ifBlank { "Music playback" })
            .setContentIntent(openApp)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", previous).build())
            .addAction(Notification.Action.Builder(
                if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (playing) "Pause" else "Play", playPause
            ).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", next).build())
            .setStyle(MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
        artworkBitmap?.takeIf { !it.isRecycled }?.let { builder.setLargeIcon(it) }
        if (Build.VERSION.SDK_INT >= 26) builder.setChannelId(CHANNEL_ID)
        return builder.build()
    }

    private fun actionIntent(action: String, requestCode: Int): PendingIntent =
        PendingIntent.getService(this, requestCode, Intent(this, MusicMediaSessionService::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun emitAction(action: String, position: Long? = null) {
        val event = org.json.JSONObject().put("version", 1).put("type", "music.action").put("action", action)
        if (position != null) event.put("position", position)
        MusicMediaSessionState.eventSink?.invoke(event.toString())
    }

    override fun onDestroy() {
        artworkRequestId.incrementAndGet()
        artworkExecutor.shutdownNow()
        artworkBitmap = null
        if (::session.isInitialized) {
            session.isActive = false
            session.release()
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "viora_music_playback"
        private const val NOTIFICATION_ID = 7312
        private const val MAX_ARTWORK_BYTES = 4 * 1024 * 1024
        private const val MAX_ARTWORK_EDGE = 512
        const val ACTION_UPDATE = "com.prempk.viora.music.UPDATE"
        const val ACTION_STATE = "com.prempk.viora.music.STATE"
        const val ACTION_STOP = "com.prempk.viora.music.STOP"
        const val ACTION_PLAY = "com.prempk.viora.music.PLAY"
        const val ACTION_PAUSE = "com.prempk.viora.music.PAUSE"
        const val ACTION_NEXT = "com.prempk.viora.music.NEXT"
        const val ACTION_PREVIOUS = "com.prempk.viora.music.PREVIOUS"
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ALBUM = "album"
        const val EXTRA_PLAYING = "playing"
        const val EXTRA_DURATION = "duration"
        const val EXTRA_ARTWORK_URL = "artworkUrl"

        fun update(context: Context, title: String, artist: String, album: String, playing: Boolean, duration: Long, artworkUrl: String) {
            val intent = Intent(context, MusicMediaSessionService::class.java).setAction(ACTION_UPDATE)
                .putExtra(EXTRA_TITLE, title).putExtra(EXTRA_ARTIST, artist).putExtra(EXTRA_ALBUM, album)
                .putExtra(EXTRA_PLAYING, playing).putExtra(EXTRA_DURATION, duration).putExtra(EXTRA_ARTWORK_URL, artworkUrl)
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        }

        fun state(context: Context, playing: Boolean) {
            context.startService(Intent(context, MusicMediaSessionService::class.java)
                .setAction(ACTION_STATE).putExtra(EXTRA_PLAYING, playing))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MusicMediaSessionService::class.java))
        }
    }
}

internal object MusicMediaSessionState {
    @Volatile var eventSink: ((String) -> Unit)? = null
}
