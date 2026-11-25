package com.prempk.viora

import android.app.Notification
import android.app.NotificationChannel
import android.app.Notification.MediaStyle
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder

/**
 * System-control proxy for WebView-owned ordinary music.
 * This service never creates or owns an audio player: WebAudio remains the sole audio path.
 */
class MusicMediaSessionService : Service() {
    private lateinit var session: MediaSession
    private lateinit var manager: NotificationManager

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
                val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().take(160)
                val artist = intent.getStringExtra(EXTRA_ARTIST).orEmpty().take(160)
                val album = intent.getStringExtra(EXTRA_ALBUM).orEmpty().take(160)
                val playing = intent.getBooleanExtra(EXTRA_PLAYING, false)
                val duration = intent.getLongExtra(EXTRA_DURATION, 0L).coerceAtLeast(0L)
                val artworkUrl = intent.getStringExtra(EXTRA_ARTWORK_URL).orEmpty().take(2048)
                session.setMetadata(
                    MediaMetadata.Builder()
                        .putString(MediaMetadata.METADATA_KEY_TITLE, title.ifBlank { "VIORA" })
                        .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                        .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                        .putLong(MediaMetadata.METADATA_KEY_DURATION, duration)
                        .apply {
                            if (artworkUrl.startsWith("https://")) {
                                putString(MediaMetadata.METADATA_KEY_ART_URI, artworkUrl)
                                putString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI, artworkUrl)
                            }
                        }
                        .build()
                )
                publishPlaybackState(playing)
                startForeground(NOTIFICATION_ID, buildNotification(playing))
            }
            ACTION_STATE -> {
                val playing = intent.getBooleanExtra(EXTRA_PLAYING, false)
                publishPlaybackState(playing)
                if (::session.isInitialized && session.isActive) {
                    manager.notify(NOTIFICATION_ID, buildNotification(playing))
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
            .setContentTitle(session.controller.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "VIORA")
            .setContentText(session.controller.metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: "Music playback")
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
