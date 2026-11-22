package com.prempk.viora

import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Android-side implementation of the two same-origin Vercel routes used by
 * the existing PWA. This keeps the bundled app independent of Vercel login,
 * SSO cookies, API hosting, and a paid server. It mirrors the PWA's public
 * LRCLIB and YouTube HTML-fallback paths.
 */
internal object VioraApiProxy {
    private const val ASSET_HOST = "appassets.androidplatform.net"
    private const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

    fun handle(request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url
        if (uri.host != ASSET_HOST || !(uri.path ?: "").startsWith("/api/")) return null

        if (request.method == "OPTIONS") return jsonResponse(200, JSONObject())
        if (request.method != "GET") {
            return jsonResponse(405, JSONObject().put("error", "Method not allowed"))
        }

        return when (uri.path) {
            "/api/lyrics" -> lyrics(uri)
            "/api/youtube/search" -> youtubeSearch(uri)
            else -> jsonResponse(404, JSONObject().put("error", "API route not found"))
        }
    }

    private fun lyrics(uri: Uri): WebResourceResponse {
        val rawTitle = (uri.getQueryParameter("track")
            ?: uri.getQueryParameter("q")
            ?: uri.getQueryParameter("title")
            ?: "").trim()
        val rawArtist = (uri.getQueryParameter("artist") ?: "").trim()
        val duration = uri.getQueryParameter("duration")?.toIntOrNull() ?: 0

        if (rawTitle.isBlank()) {
            return jsonResponse(400, JSONObject().put("error", "Track title or query is required"))
        }

        val title = cleanTitle(rawTitle)
        val artist = cleanArtist(rawArtist)
        val queries = linkedSetOf<String>()

        if (title.isNotBlank() && artist.isNotBlank()) queries.add("$title $artist")
        if (title.isNotBlank()) queries.add(title)
        if (rawTitle.contains("-")) {
            val parts = rawTitle.split("-").map { cleanTitle(it) }.filter { it.isNotBlank() }
            if (parts.size >= 2) {
                queries.add(parts[0])
                queries.add(parts[1])
                queries.add("${parts[0]} ${parts[1]}")
            }
        }
        if (rawTitle.contains("|")) {
            cleanTitle(rawTitle.substringBefore("|")).takeIf { it.isNotBlank() }?.let(queries::add)
        }
        cleanTitle(rawTitle.replace(Regex("\\(.*?\\)|\\[.*?\\]"), ""))
            .takeIf { it.isNotBlank() }?.let(queries::add)
        val words = title.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.size >= 3) {
            queries.add(words.take(2).joinToString(" "))
            queries.add(words.dropLast(1).joinToString(" "))
        }

        val candidates = mutableListOf<JSONObject>()
        val seenIds = mutableSetOf<String>()

        if (artist.isNotBlank() && title.isNotBlank()) {
            var exactUrl = "https://lrclib.net/api/get?artist_name=${enc(artist)}&track_name=${enc(title)}"
            if (duration > 0) exactUrl += "&duration=$duration"
            queryLyrics(exactUrl).forEach { record ->
                if (hasLyrics(record)) {
                    candidates.add(record)
                    record.optString("id").takeIf { it.isNotBlank() }?.let(seenIds::add)
                }
            }
        }

        for (query in queries.take(3)) {
            if (candidates.any { it.optString("syncedLyrics").isNotBlank() }) break
            queryLyrics("https://lrclib.net/api/search?q=${enc(query)}").forEach { record ->
                val id = record.optString("id")
                if (hasLyrics(record) && id.isNotBlank() && seenIds.add(id)) {
                    candidates.add(record)
                }
            }
        }

        if (candidates.isEmpty()) {
            return jsonResponse(200, JSONObject()
                .put("found", false)
                .put("message", "No synchronized lyrics found for this track")
                .put("track", title)
                .put("artist", artist))
        }

        val expectedLanguage = detectLanguage("", title, artist)
        var best: JSONObject? = null
        var bestScore = -1

        candidates.forEach { record ->
            val text = record.optString("syncedLyrics").ifBlank { record.optString("plainLyrics") }
            if (text.isBlank()) return@forEach
            var score = 0
            if (record.optString("syncedLyrics").isNotBlank()) score += 60
            if (expectedLanguage.name == "Hindi" && Regex("[\\u0900-\\u097F]").containsMatchIn(text)) score += 80
            if (expectedLanguage.name == "Punjabi" && Regex("[\\u0A00-\\u0A7F]").containsMatchIn(text)) score += 80

            val recordTitle = record.optString("trackName").trim().lowercase(Locale.ROOT)
            val expectedTitle = title.lowercase(Locale.ROOT)
            if (recordTitle.isNotBlank() && expectedTitle.isNotBlank()) {
                if (recordTitle == expectedTitle) score += 40
                else if (recordTitle.contains(expectedTitle) || expectedTitle.contains(recordTitle)) score += 20
            }

            val recordArtist = record.optString("artistName").trim().lowercase(Locale.ROOT)
            val expectedArtist = artist.lowercase(Locale.ROOT)
            if (recordArtist.isNotBlank() && expectedArtist.isNotBlank() &&
                (recordArtist.contains(expectedArtist) || expectedArtist.contains(recordArtist))) score += 30

            val recordDuration = record.optDouble("duration", 0.0).toInt()
            if (duration > 0 && recordDuration > 0) {
                val diff = kotlin.math.abs(recordDuration - duration)
                if (diff < 15) score += 25 else if (diff < 35) score += 10
            }

            if (score > bestScore) {
                bestScore = score
                best = record
            }
        }

        val record = best
        if (record == null) {
            return jsonResponse(200, JSONObject()
                .put("found", false)
                .put("message", "No suitable lyrics found for this track")
                .put("track", title)
                .put("artist", artist))
        }

        val synced = record.optString("syncedLyrics").takeIf { it.isNotBlank() }
        val plain = record.optString("plainLyrics").takeIf { it.isNotBlank() }
        val detected = detectLanguage((synced ?: plain ?: "").take(1000), title, artist)
        val trackName = record.optString("trackName").ifBlank { title }
        val artistName = record.optString("artistName").ifBlank { artist }

        return jsonResponse(200, JSONObject()
            .put("found", true)
            .put("id", record.opt("id"))
            .put("trackName", trackName)
            .put("artistName", artistName)
            .put("albumName", record.optString("albumName"))
            .put("duration", record.opt("duration"))
            .put("language", detected.name)
            .put("code", detected.code)
            .put("flag", detected.flag)
            .put("nativeScript", detected.label)
            .put("hasSynced", synced != null)
            .put("syncedLyrics", synced ?: JSONObject.NULL)
            .put("plainLyrics", plain ?: JSONObject.NULL)
            .put("source", "LRCLIB: $trackName — $artistName"))
    }

    private data class Language(
        val name: String,
        val code: String,
        val flag: String,
        val label: String
    )

    private fun detectLanguage(text: String, title: String, artist: String): Language {
        val combined = "$text $title $artist".lowercase(Locale.ROOT)
        return when {
            Regex("[\\u0900-\\u097F]").containsMatchIn(text) ||
                Regex("[\\u0900-\\u097F]").containsMatchIn(title) ->
                Language("Hindi", "hi", "🇮🇳", "हिंदी (Hindi)")
            Regex("[\\u0A00-\\u0A7F]").containsMatchIn(text) ||
                Regex("[\\u0A00-\\u0A7F]").containsMatchIn(title) ->
                Language("Punjabi", "pa", "🇮🇳", "ਪੰਜਾਬੀ (Punjabi)")
            Regex("[\\u3040-\\u309F\\u30A0-\\u30FF\\u4E00-\\u9FAF]").containsMatchIn(text) ->
                Language("Japanese", "ja", "🇯🇵", "日本語 (Japanese)")
            Regex("[\\uAC00-\\uD7AF\\u1100-\\u11FF]").containsMatchIn(text) ->
                Language("Korean", "ko", "🇰🇷", "한국어 (Korean)")
            Regex("[\\u0600-\\u06FF]").containsMatchIn(text) ->
                Language("Urdu", "ur", "🇵🇰", "اردو (Urdu)")
            Regex("\\b(tere|meri|mera|tujhe|hum|tum|dil|ishq|pyar|pyaar|zindagi|saath|mohabbat|kahaani|kabhi|jaana|sanam)\\b")
                .containsMatchIn(combined) ->
                Language("Hindi", "hi", "🇮🇳", "हिंदी / Hinglish")
            Regex("\\b(kudi|munda|akhan|sohni|gallan|yaara|vich|nach|pind|jatt|pasoori|excuses)\\b")
                .containsMatchIn(combined) ->
                Language("Punjabi", "pa", "🇮🇳", "ਪੰਜਾਬੀ / Punjabi")
            Regex("[ñáéíóú¿¡]").containsMatchIn(text) ||
                Regex("\\b(despacito|corazón|bailar|canción|hermosa|amor|noche|vida)\\b").containsMatchIn(combined) ->
                Language("Spanish", "es", "🇪🇸", "Español (Spanish)")
            Regex("[éèêëàâîïôûùçœ]").containsMatchIn(text) ||
                Regex("\\b(bonjour|monde|avec|dans|cœur|amour)\\b").containsMatchIn(combined) ->
                Language("French", "fr", "🇫🇷", "Français (French)")
            else -> Language("English", "en", "🇺🇸", "English")
        }
    }

    private fun youtubeSearch(uri: Uri): WebResourceResponse {
        val query = (uri.getQueryParameter("q") ?: "").trim()
        val maxResults = (uri.getQueryParameter("maxResults")?.toIntOrNull() ?: 15).coerceIn(1, 30)
        if (query.isBlank()) {
            return jsonResponse(400, JSONObject()
                .put("error", "Query parameter 'q' is required")
                .put("items", JSONArray()))
        }

        val html = fetchText(
            "https://www.youtube.com/results?search_query=${enc(query)}",
            mapOf("User-Agent" to USER_AGENT, "Accept-Language" to "en-US,en;q=0.9")
        )
        if (html.isNullOrBlank()) {
            return jsonResponse(200, JSONObject()
                .put("items", JSONArray())
                .put("nextPageToken", JSONObject.NULL)
                .put("totalResults", 0)
                .put("isCuratedFallback", false)
                .put("message", "Live YouTube search is temporarily unavailable. Please try again."))
        }

        val items = JSONArray()
        val seenIds = mutableSetOf<String>()
        val renderer = Regex(
            """"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)""",
            setOf(RegexOption.DOT_MATCHES_ALL)
        )
        val channelPattern = Regex(
            """"ownerText":\{"runs":\[\{"text":"([^"]+)""",
            setOf(RegexOption.DOT_MATCHES_ALL)
        )
        val channelPattern = Regex(
            """"ownerText":\\{"runs":\\[\\{"text":"([^"]+)""",
            setOf(RegexOption.DOT_MATCHES_ALL)
        )
        val channelPattern = Regex(
            "\"ownerText\":\\{\\"runs\\":\\[\\{\\"text\\":\\"([^\\"]+)",
            setOf(RegexOption.DOT_MATCHES_ALL)
        )

        for (match in renderer.findAll(html)) {
            if (items.length() >= maxResults) break
            val videoId = match.groupValues[1]
            if (!seenIds.add(videoId)) continue
            val rawTitle = decodeHtmlEntities(decodeJsonString(match.groupValues[2]))
            val context = html.substring(match.range.first, minOf(html.length, match.range.first + 1000))
            val channelMatch = channelPattern.find(context)
            val rawChannel = channelMatch?.groupValues?.getOrNull(1)
                ?.let { decodeHtmlEntities(decodeJsonString(it)) }.orEmpty()
            items.put(makeYoutubeItem(videoId, rawTitle, rawChannel))
        }

        if (items.length() == 0) {
            val genericIds = Regex("\"videoId\":\"([A-Za-z0-9_-]{11})\"")
            for (match in genericIds.findAll(html)) {
                if (items.length() >= maxResults) break
                val videoId = match.groupValues[1]
                if (seenIds.add(videoId)) items.put(makeYoutubeItem(videoId, query, "Official Music Video"))
            }
        }

        return jsonResponse(200, JSONObject()
            .put("items", items)
            .put("nextPageToken", JSONObject.NULL)
            .put("totalResults", items.length())
            .put("source", "youtube-web-direct")
            .put("isCuratedFallback", false)
            .put("message", if (items.length() == 0) "Live YouTube search is temporarily unavailable. Please try again." else JSONObject.NULL))
    }

    private fun makeYoutubeItem(videoId: String, originalTitle: String, channel: String): JSONObject {
        var title = originalTitle
        var artist = channel.ifBlank { "Official Video" }
        if (title.contains(" - ")) {
            val parts = title.split(" - ")
            if (parts.size >= 2) {
                val first = parts.first().trim()
                val rest = parts.drop(1).joinToString(" - ").trim()
                if (!first.contains("official", true) && !first.contains("video", true) && !first.contains("lyrics", true)) {
                    artist = first
                    title = rest
                } else {
                    title = first
                    artist = rest
                }
            }
        } else if (title.contains(" | ")) {
            val parts = title.split(" | ")
            title = parts.first().trim()
            if (parts.size > 1 && !parts[1].contains("official", true)) artist = parts[1].trim()
        }

        title = title.replace(
            Regex("[\\(\\[][^\\)\\]]*(?:official|video|audio|lyric|lyrics|full song|hd|4k|remastered|teaser|promo|exclusive|jhankar)[^\\)\\]]*[\\)\\]]", RegexOption.IGNORE_CASE),
            ""
        ).replace(Regex("\\|\\s*.*$"), "").trim().ifBlank { originalTitle }
        artist = artist.replace(
            Regex("(?:VEVO|Official|Music|Records|Channel|Entertainment)$", RegexOption.IGNORE_CASE),
            ""
        ).trim().ifBlank { channel.ifBlank { "Official Video" } }

        val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        return JSONObject()
            .put("id", "youtube:$videoId")
            .put("youtubeId", videoId)
            .put("source", "youtube")
            .put("title", title)
            .put("artist", artist)
            .put("album", if (channel.isNotBlank()) "$channel • YouTube Music" else "YouTube Music Video")
            .put("genre", "YouTube")
            .put("duration", 215)
            .put("artwork", "https://i.ytimg.com/vi/$videoId/hqdefault.jpg")
            .put("format", "HD AUDIO")
            .put("bitrate", "320 kbps")
            .put("addedDate", date)
    }

    private fun queryLyrics(url: String): List<JSONObject> {
        val raw = fetchText(url, mapOf("LrcLib-Client" to "VIORA-MusicPlayer (Android)")) ?: return emptyList()
        return try {
            when (val parsed = JSONTokener(raw).nextValue()) {
                is JSONArray -> (0 until parsed.length()).mapNotNull { parsed.optJSONObject(it) }
                is JSONObject -> listOf(parsed)
                else -> emptyList()
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun hasLyrics(record: JSONObject): Boolean =
        record.optString("syncedLyrics").isNotBlank() || record.optString("plainLyrics").isNotBlank()

    private fun cleanTitle(raw: String): String {
        var value = raw.replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\"")
        value = value.replace(Regex("\\.(mp3|m4a|flac|wav|aac|ogg|wma|weba|opus|alac)$", RegexOption.IGNORE_CASE), "")
        value = value.replace(Regex("([a-zA-Z0-9])_([a-zA-Z0-9])"), "$1 $2").replace("_", " ")
        value = value.replace(Regex("([a-zA-Z])\\.([a-zA-Z])"), "$1 $2")
        value = value.replace(
            Regex("\\|\\s*(?:T-Series|Zee Music Company|Sony Music India|YRF|Tips Official|Speed Records|Saregama|Geet MP3|White Hill Music)[^|]*", RegexOption.IGNORE_CASE),
            ""
        ).replace(Regex("\\|.*$"), "")
        value = value.replace(
            Regex("[\\(\\[\\{]?(?:https?://)?(?:www\\.)?[a-zA-Z0-9_-]+\\.(?:com|in|net|org|co|info|biz|cc|xyz|top|site|me|pw)[\\)\\]\\}]?", RegexOption.IGNORE_CASE),
            ""
        )
        value = value.replace(Regex("\\b\\d{2,3}\\s*kbps\\b", RegexOption.IGNORE_CASE), "")
        value = value.replace(
            Regex("\\b(remastered|remaster|hq|hd|uhd|4k|flac|audio|official|lyrical|lyric video|official video|official music video|music video|video song|video|full song|full audio|full video|slowed|reverb|original|jhankar|dolby|atmos|unplugged|acoustic|cover|instrumental)\\b", RegexOption.IGNORE_CASE),
            ""
        )
        value = value.replace(Regex("^(track\\s*)?\\d+[\\s._-]+", RegexOption.IGNORE_CASE), "")
        return value.replace(Regex("\\(\\s*\\)|\\[\\s*\\]|\\{\\s*\\}"), "")
            .replace(Regex("\\s{2,}"), " ").trim(' ', '-', '_', '—', '~', ':')
    }

    private fun cleanArtist(raw: String): String {
        val lower = raw.lowercase(Locale.ROOT).trim()
        if (listOf("local artist", "unknown", "various", "artist", "t-series", "vevo", "zee music", "speed records")
                .any { lower.contains(it) }) return ""
        return raw.replace(Regex("feat\\..*", RegexOption.IGNORE_CASE), "")
            .replace(Regex("ft\\..*", RegexOption.IGNORE_CASE), "")
            .substringBefore(",").trim()
    }

    private fun decodeHtmlEntities(value: String): String = value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")

    private fun decodeJsonString(value: String): String = try {
        JSONTokener("\"$value\"").nextValue() as? String ?: value
    } catch (_: Exception) {
        value
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8")

    private fun fetchText(url: String, headers: Map<String, String> = emptyMap()): String? {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 9000
                readTimeout = 14000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", USER_AGENT)
                headers.forEach { (key, value) -> setRequestProperty(key, value) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
        } catch (_: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    private fun jsonResponse(status: Int, json: JSONObject): WebResourceResponse {
        val body = json.toString().toByteArray(Charsets.UTF_8)
        return WebResourceResponse(
            "application/json",
            "UTF-8",
            status,
            when (status) {
                200 -> "OK"
                400 -> "Bad Request"
                404 -> "Not Found"
                405 -> "Method Not Allowed"
                else -> "Service Unavailable"
            },
            mapOf(
                "Cache-Control" to "no-store",
                "Access-Control-Allow-Origin" to "*",
                "Access-Control-Allow-Methods" to "GET, OPTIONS",
                "Access-Control-Allow-Headers" to "Content-Type"
            ),
            ByteArrayInputStream(body)
        )
    }
}
