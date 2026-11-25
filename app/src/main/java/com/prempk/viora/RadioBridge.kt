package com.prempk.viora

import android.content.Context
import android.net.Uri
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/** Origin-scoped, schema-validated bridge for the Android-only radio adapter. */
internal class RadioBridge(
    private val context: Context,
    private val webView: WebView
) {
    @Volatile private var replyProxy: JavaScriptReplyProxy? = null

    fun install(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false

        WebViewCompat.addWebMessageListener(
            webView,
            JS_OBJECT_NAME,
            setOf(ASSET_ORIGIN)
        ) { _, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, proxy: JavaScriptReplyProxy ->
            if (!isMainFrame || sourceOrigin.toString() != ASSET_ORIGIN ||
                message.type != WebMessageCompat.TYPE_STRING
            ) {
                proxy.postMessage(errorJson("", "REJECTED_ORIGIN").toString())
                return@addWebMessageListener
            }
            replyProxy = proxy
            handleMessage(message.data ?: "", proxy)
        }

        RadioPlaybackState.eventSink = { payload ->
            try {
                replyProxy?.postMessage(payload)
            } catch (_: Exception) {
                replyProxy = null
            }
        }
        MusicMediaSessionState.eventSink = { payload ->
            try { replyProxy?.postMessage(payload) } catch (_: Exception) { replyProxy = null }
        }
        return true
    }

    fun close() {
        replyProxy = null
        RadioPlaybackState.eventSink = null
        MusicMediaSessionState.eventSink = null
    }

    private fun handleMessage(raw: String, proxy: JavaScriptReplyProxy) {
        if (raw.length > MAX_MESSAGE_CHARS) {
            proxy.postMessage(errorJson("", "MESSAGE_TOO_LARGE").toString())
            return
        }

        val request = try {
            JSONObject(raw)
        } catch (_: Exception) {
            proxy.postMessage(errorJson("", "INVALID_JSON").toString())
            return
        }

        val requestId = request.optString("requestId")
        if (request.optInt("version", -1) != 1 ||
            requestId.isBlank() || requestId.length > 64
        ) {
            proxy.postMessage(errorJson(requestId, "INVALID_ENVELOPE").toString())
            return
        }

        val command = request.optString("command")
        val expectedKeys = when (command) {
            "radio.play" -> setOf("version", "requestId", "command", "stationId", "streamUrl", "title", "artist", "artworkUrl", "bitrate")
            "radio.pause", "radio.resume", "radio.stop", "radio.getSnapshot" ->
                setOf("version", "requestId", "command")
            "radio.setVolume" -> setOf("version", "requestId", "command", "volume")
            "music.update" -> setOf("version", "requestId", "command", "title", "artist", "album", "playing", "duration", "artworkUrl")
            "music.state" -> setOf("version", "requestId", "command", "playing")
            "music.stop" -> setOf("version", "requestId", "command")
            else -> {
                proxy.postMessage(errorJson(requestId, "UNKNOWN_COMMAND").toString())
                return
            }
        }
        val actualKeys = request.keys().asSequence().toSet()
        if (actualKeys != expectedKeys) {
            proxy.postMessage(errorJson(requestId, "INVALID_FIELDS").toString())
            return
        }

        try {
            RadioPlaybackService.restoreSnapshot(context)
            when (command) {
                "music.update" -> {
                    if (RadioPlaybackState.stationId.isNotBlank()) {
                        proxy.postMessage(errorJson(requestId, "RADIO_OWNS_PLAYBACK").toString())
                        return
                    }
                    val title = request.getString("title")
                    val artist = request.getString("artist")
                    val album = request.getString("album")
                    val playing = request.getBoolean("playing")
                    val duration = request.getLong("duration")
                    val artworkUrl = request.getString("artworkUrl")
                    if (title.isBlank() || title.length > 160 || artist.length > 160 ||
                        album.length > 160 || duration < 0L || duration > 86_400_000L || artworkUrl.length > 2048) {
                        proxy.postMessage(errorJson(requestId, "INVALID_METADATA").toString())
                        return
                    }
                    MusicMediaSessionService.update(context, title, artist, album, playing, duration, artworkUrl)
                }
                "music.state" -> {
                    if (RadioPlaybackState.stationId.isNotBlank()) {
                        proxy.postMessage(errorJson(requestId, "RADIO_OWNS_PLAYBACK").toString())
                        return
                    }
                    MusicMediaSessionService.state(context, request.getBoolean("playing"))
                }
                "music.stop" -> MusicMediaSessionService.stop(context)
                "radio.play" -> {
                    val stationId = request.getString("stationId")
                    val streamUrl = request.getString("streamUrl")
                    val title = request.getString("title")
                    val artist = request.getString("artist")
                    val artwork = request.getString("artworkUrl")
                    val bitrate = request.getString("bitrate")
                    if (!RadioPlaybackService.isApprovedStation(stationId, streamUrl) ||
                        title.isBlank() || title.length > 120 ||
                        artist.length > 120 || bitrate.length > 40 ||
                        (artwork.isNotBlank() && !artwork.startsWith("https://images.unsplash.com/"))
                    ) {
                        proxy.postMessage(errorJson(requestId, "INVALID_STATION").toString())
                        return
                    }
                    // Mark the requested owner before dispatch so an immediate source switch
                    // queues radio.stop behind radio.play even while the service is starting.
                    // The radio Media3 session and ordinary WebAudio control proxy are exclusive.
                    MusicMediaSessionService.stop(context)
                    RadioPlaybackState.stationId = stationId
                    RadioPlaybackState.title = title
                    RadioPlaybackState.artist = artist
                    RadioPlaybackState.artwork = artwork
                    RadioPlaybackState.bitrate = bitrate
                    RadioPlaybackService.startPlay(context, stationId, streamUrl, title, artist, artwork, bitrate)
                }
                "radio.pause" -> RadioPlaybackService.dispatch(context, RadioPlaybackService.ACTION_PAUSE)
                "radio.resume" -> RadioPlaybackService.dispatch(context, RadioPlaybackService.ACTION_RESUME)
                "radio.stop" -> {
                    if (RadioPlaybackState.stationId.isBlank()) {
                        RadioPlaybackService.dispatch(context, RadioPlaybackService.ACTION_STOP)
                    } else {
                        RadioPlaybackState.pendingStopRequestId = requestId
                        RadioPlaybackService.dispatch(context, RadioPlaybackService.ACTION_STOP)
                        // The service replies with radio.stopped only after its player is cleared.
                        if (RadioPlaybackState.stationId.isBlank()) return
                        return
                    }
                }
                "radio.setVolume" -> {
                    val volume = request.getDouble("volume")
                    if (!volume.isFinite() || volume !in 0.0..1.0) {
                        proxy.postMessage(errorJson(requestId, "INVALID_VOLUME").toString())
                        return
                    }
                    RadioPlaybackService.dispatch(context, RadioPlaybackService.ACTION_VOLUME, volume.toFloat())
                }
                "radio.getSnapshot" -> {
                    val snapshot = RadioPlaybackState.toJson("radio.snapshot")
                        .put("requestId", requestId)
                    proxy.postMessage(snapshot.toString())
                    return
                }
            }
            proxy.postMessage(JSONObject()
                .put("version", 1)
                .put("requestId", requestId)
                .put("ok", true)
                .put("accepted", true)
                .toString())
        } catch (_: Exception) {
            proxy.postMessage(errorJson(requestId, "COMMAND_FAILED").toString())
        }
    }

    private fun errorJson(requestId: String, code: String): JSONObject = JSONObject()
        .put("version", 1)
        .put("requestId", requestId)
        .put("ok", false)
        .put("errorCode", code)

    companion object {
        private const val JS_OBJECT_NAME = "VioraNative"
        private const val ASSET_ORIGIN = "https://appassets.androidplatform.net"
        private const val MAX_MESSAGE_CHARS = 16 * 1024
    }
}
