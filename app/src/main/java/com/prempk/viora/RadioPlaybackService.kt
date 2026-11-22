package com.prempk.viora

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.json.JSONObject

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class RadioPlaybackService : MediaSessionService() {
    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSession

    override fun onCreate() {
        super.onCreate()
        // Let ExoPlayer manage Android audio focus and pause on headphone disconnect.
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        RadioPlaybackState.commandSink = { intent ->
            when (intent.action) {
                ACTION_PLAY -> {
                    playStation(
                        intent.getStringExtra(EXTRA_STATION_ID).orEmpty(),
                        intent.getStringExtra(EXTRA_STREAM_URL).orEmpty(),
                        intent.getStringExtra(EXTRA_TITLE).orEmpty(),
                        intent.getStringExtra(EXTRA_ARTIST).orEmpty(),
                        intent.getStringExtra(EXTRA_ARTWORK).orEmpty(),
                        intent.getStringExtra(EXTRA_BITRATE).orEmpty()
                    )
                    true
                }
                ACTION_PAUSE -> { player.pause(); true }
                ACTION_RESUME -> {
                    if (player.mediaItemCount == 0) restoreSavedStationToPlayer()
                    if (player.mediaItemCount > 0) {
                        if (player.playbackState == Player.STATE_IDLE) player.prepare()
                        player.play()
                    }
                    true
                }
                ACTION_STOP -> { stopAndClear(); true }
                ACTION_VOLUME -> {
                    player.volume = intent.getFloatExtra(EXTRA_VOLUME, 1f).coerceIn(0f, 1f)
                    RadioPlaybackState.volume = player.volume
                    publishState()
                    true
                }
                else -> false
            }
        }
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                RadioPlaybackState.isPlaying = isPlaying
                publishState()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                RadioPlaybackState.isBuffering = playbackState == Player.STATE_BUFFERING
                publishState()
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                RadioPlaybackState.errorCode = "STREAM_ERROR"
                RadioPlaybackState.isPlaying = false
                publishState()
            }
        })
        restoreSavedStationToPlayer()
        mediaSession = MediaSession.Builder(this, player)
            .setCallback(object : MediaSession.Callback {
                override fun onConnect(
                    session: MediaSession,
                    controller: MediaSession.ControllerInfo
                ): MediaSession.ConnectionResult {
                    // External controllers receive only play/pause and read-only metadata.
                    val commands = Player.Commands.Builder()
                        .add(Player.COMMAND_PLAY_PAUSE)
                        .add(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)
                        .add(Player.COMMAND_GET_METADATA)
                        .add(Player.COMMAND_GET_TIMELINE)
                        .build()
                    return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                        .setAvailablePlayerCommands(commands)
                        .build()
                }
            })
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession = mediaSession

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val serviceStartResult = super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_PLAY -> playStation(
                intent.getStringExtra(EXTRA_STATION_ID).orEmpty(),
                intent.getStringExtra(EXTRA_STREAM_URL).orEmpty(),
                intent.getStringExtra(EXTRA_TITLE).orEmpty(),
                intent.getStringExtra(EXTRA_ARTIST).orEmpty(),
                intent.getStringExtra(EXTRA_ARTWORK).orEmpty(),
                intent.getStringExtra(EXTRA_BITRATE).orEmpty()
            )
            ACTION_PAUSE -> if (::player.isInitialized) player.pause()
            ACTION_RESUME -> if (::player.isInitialized) {
                if (player.mediaItemCount == 0) restoreSavedStationToPlayer()
                if (player.mediaItemCount > 0) {
                    if (player.playbackState == Player.STATE_IDLE) player.prepare()
                    player.play()
                }
            }
            ACTION_STOP -> stopAndClear()
            ACTION_VOLUME -> if (::player.isInitialized) {
                player.volume = (intent.getFloatExtra(EXTRA_VOLUME, 1f)).coerceIn(0f, 1f)
                RadioPlaybackState.volume = player.volume
                publishState()
            }
        }
        return serviceStartResult
    }

    private fun createMediaItem(
        stationId: String,
        streamUrl: String,
        title: String,
        artist: String,
        artwork: String
    ): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setAlbumTitle("VIORA • Live Radio")
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .apply { if (artwork.isNotBlank()) setArtworkUri(Uri.parse(artwork)) }
            .build()
        return MediaItem.Builder()
            .setMediaId(stationId)
            .setUri(Uri.parse(streamUrl))
            .setMediaMetadata(metadata)
            .build()
    }

    private fun restoreSavedStationToPlayer() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val stationId = prefs.getString(PREF_STATION_ID, "").orEmpty()
        val streamUrl = prefs.getString(PREF_STREAM_URL, "").orEmpty()
        if (!isApprovedStation(stationId, streamUrl)) return
        val title = prefs.getString(PREF_TITLE, "").orEmpty()
        val artist = prefs.getString(PREF_ARTIST, "").orEmpty()
        val artwork = prefs.getString(PREF_ARTWORK, "").orEmpty()
        val bitrate = prefs.getString(PREF_BITRATE, "").orEmpty()
        if (title.isBlank() || title.length > 120 || artist.length > 120 ||
            (artwork.isNotBlank() && !artwork.startsWith("https://images.unsplash.com/"))
        ) return
        RadioPlaybackState.stationId = stationId
        RadioPlaybackState.title = title
        RadioPlaybackState.artist = artist
        RadioPlaybackState.artwork = artwork
        RadioPlaybackState.bitrate = bitrate
        if (player.mediaItemCount == 0) {
            player.setMediaItem(createMediaItem(stationId, streamUrl, title, artist, artwork))
        }
    }

    private fun saveStation(
        stationId: String,
        streamUrl: String,
        title: String,
        artist: String,
        artwork: String,
        bitrate: String
    ) {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
            .putString(PREF_STATION_ID, stationId)
            .putString(PREF_STREAM_URL, streamUrl)
            .putString(PREF_TITLE, title)
            .putString(PREF_ARTIST, artist)
            .putString(PREF_ARTWORK, artwork)
            .putString(PREF_BITRATE, bitrate)
            .apply()
    }

    private fun playStation(
        stationId: String,
        streamUrl: String,
        title: String,
        artist: String,
        artwork: String,
        bitrate: String
    ) {
        val approvedUrl = APPROVED_STREAMS[stationId]
        if (approvedUrl == null || approvedUrl != streamUrl ||
            !streamUrl.startsWith("https://") || title.isBlank() || title.length > 120 ||
            artist.length > 120 || bitrate.length > 40 ||
            (artwork.isNotBlank() && !artwork.startsWith("https://images.unsplash.com/"))
        ) {
            RadioPlaybackState.errorCode = "INVALID_STATION"
            publishState()
            return
        }

        RadioPlaybackState.stationId = stationId
        RadioPlaybackState.title = title
        RadioPlaybackState.artist = artist
        RadioPlaybackState.artwork = artwork
        RadioPlaybackState.bitrate = bitrate
        RadioPlaybackState.errorCode = ""
        RadioPlaybackState.isBuffering = true
        RadioPlaybackState.isPlaying = false
        saveStation(stationId, streamUrl, title, artist, artwork, bitrate)
        player.setMediaItem(createMediaItem(stationId, streamUrl, title, artist, artwork))
        player.prepare()
        player.play()
        publishState()
    }

    private fun stopAndClear() {
        if (::player.isInitialized) {
            player.pause()
            player.clearMediaItems()
            player.stop()
        }
        RadioPlaybackState.stationId = ""
        RadioPlaybackState.title = ""
        RadioPlaybackState.artist = ""
        RadioPlaybackState.artwork = ""
        RadioPlaybackState.bitrate = ""
        RadioPlaybackState.isPlaying = false
        RadioPlaybackState.isBuffering = false
        RadioPlaybackState.errorCode = ""
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().clear().apply()
        val stopRequestId = RadioPlaybackState.pendingStopRequestId
        RadioPlaybackState.pendingStopRequestId = ""
        publishState(
            if (stopRequestId.isNotBlank()) "radio.stopped" else "radio.state",
            stopRequestId
        )
    }

    private fun publishState(type: String = "radio.state", requestId: String = "") {
        val payload = RadioPlaybackState.toJson(type)
        if (requestId.isNotBlank()) payload.put("requestId", requestId)
        RadioPlaybackState.eventSink?.invoke(payload.toString())
    }

    override fun onDestroy() {
        RadioPlaybackState.commandSink = null
        if (::mediaSession.isInitialized) mediaSession.release()
        if (::player.isInitialized) player.release()
        super.onDestroy()
    }

    companion object {
        const val ACTION_PLAY = "com.prempk.viora.radio.PLAY"
        const val ACTION_PAUSE = "com.prempk.viora.radio.PAUSE"
        const val ACTION_RESUME = "com.prempk.viora.radio.RESUME"
        const val ACTION_STOP = "com.prempk.viora.radio.STOP"
        const val ACTION_VOLUME = "com.prempk.viora.radio.VOLUME"

        const val EXTRA_STATION_ID = "stationId"
        const val EXTRA_STREAM_URL = "streamUrl"
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ARTWORK = "artwork"
        const val EXTRA_BITRATE = "bitrate"
        const val EXTRA_VOLUME = "volume"

        private const val PREFS_NAME = "viora_native_radio"
        private const val PREF_STATION_ID = "stationId"
        private const val PREF_STREAM_URL = "streamUrl"
        private const val PREF_TITLE = "title"
        private const val PREF_ARTIST = "artist"
        private const val PREF_ARTWORK = "artwork"
        private const val PREF_BITRATE = "bitrate"

        private val APPROVED_STREAMS = mapOf(
            "rad-1" to "https://drive.uber.radio/uber/bollywoodnow/icecast.audio",
            "rad-2" to "https://drive.uber.radio/uber/bollywoodlove/icecast.audio",
            "rad-3" to "https://drive.uber.radio/uber/bollywood2010s/icecast.audio",
            "rad-4" to "https://2.mystreaming.net/uber/bollywood2000s/icecast.audio",
            "rad-5" to "https://radio.plaza.one/mp3",
            "rad-6" to "https://ice1.somafm.com/groovesalad-256-mp3",
            "rad-7" to "https://stream.radioparadise.com/mp3-320",
            "rad-8" to "https://ice2.somafm.com/defcon-256-mp3",
            "rad-9" to "https://stream-relay-geo.ntslive.net/stream",
            "rad-10" to "https://ice4.somafm.com/indiepop-128-mp3",
            "rad-11" to "https://stream.srg-ssr.ch/m/rsc_de/mp3_128",
            "rad-12" to "https://ice1.somafm.com/secretagent-128-mp3"
        )

        fun isApprovedStation(stationId: String, streamUrl: String): Boolean =
            APPROVED_STREAMS[stationId] == streamUrl

        fun restoreSnapshot(context: Context) {
            if (RadioPlaybackState.stationId.isNotBlank()) return
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val stationId = prefs.getString(PREF_STATION_ID, "").orEmpty()
            val streamUrl = prefs.getString(PREF_STREAM_URL, "").orEmpty()
            if (!isApprovedStation(stationId, streamUrl)) return
            RadioPlaybackState.stationId = stationId
            RadioPlaybackState.title = prefs.getString(PREF_TITLE, "").orEmpty()
            RadioPlaybackState.artist = prefs.getString(PREF_ARTIST, "").orEmpty()
            RadioPlaybackState.artwork = prefs.getString(PREF_ARTWORK, "").orEmpty()
            RadioPlaybackState.bitrate = prefs.getString(PREF_BITRATE, "").orEmpty()
            RadioPlaybackState.isPlaying = false
            RadioPlaybackState.isBuffering = false
        }

        fun startPlay(
            context: Context,
            stationId: String,
            streamUrl: String,
            title: String,
            artist: String,
            artwork: String,
            bitrate: String
        ) {
            val intent = Intent(context, RadioPlaybackService::class.java).apply {
                action = ACTION_PLAY
                putExtra(EXTRA_STATION_ID, stationId)
                putExtra(EXTRA_STREAM_URL, streamUrl)
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_ARTIST, artist)
                putExtra(EXTRA_ARTWORK, artwork)
                putExtra(EXTRA_BITRATE, bitrate)
            }
            if (RadioPlaybackState.commandSink?.invoke(intent) != true) {
                ContextCompat.startForegroundService(context, intent)
            }
        }

        fun dispatch(context: Context, action: String, volume: Float? = null) {
            val intent = Intent(context, RadioPlaybackService::class.java).setAction(action)
            if (volume != null) intent.putExtra(EXTRA_VOLUME, volume.coerceIn(0f, 1f))
            if (RadioPlaybackState.commandSink?.invoke(intent) == true) return
            // Do not create a service merely to control an idle player.
            if (RadioPlaybackState.stationId.isBlank()) return
            context.startService(intent)
        }
    }
}

internal object RadioPlaybackState {
    @Volatile var stationId: String = ""
    @Volatile var title: String = ""
    @Volatile var artist: String = ""
    @Volatile var artwork: String = ""
    @Volatile var bitrate: String = ""
    @Volatile var isPlaying: Boolean = false
    @Volatile var isBuffering: Boolean = false
    @Volatile var volume: Float = 1f
    @Volatile var errorCode: String = ""
    @Volatile var eventSink: ((String) -> Unit)? = null
    @Volatile var commandSink: ((Intent) -> Boolean)? = null
    @Volatile var pendingStopRequestId: String = ""

    fun toJson(type: String): JSONObject = JSONObject()
        .put("version", 1)
        .put("type", type)
        .put("stationId", stationId)
        .put("title", title)
        .put("artist", artist)
        .put("artworkUrl", artwork)
        .put("bitrate", bitrate)
        .put("isPlaying", isPlaying)
        .put("isBuffering", isBuffering)
        .put("volume", volume.toDouble())
        .put("errorCode", errorCode)
}
