package com.prempk.viora

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .setDomain(ASSET_HOST)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(5, 7, 20)
        window.navigationBarColor = Color.rgb(5, 7, 20)

        webView = WebView(this)
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
            loadsImagesAutomatically = true
            useWideViewPort = true
            loadWithOverviewMode = true
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }

        webView.addJavascriptInterface(AndroidInfoBridge(), "VioraAndroid")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                pendingFileCallback?.onReceiveValue(null)
                pendingFileCallback = filePathCallback
                return try {
                    val intent = fileChooserParams?.createIntent()
                        ?: Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "audio/*"
                        }
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    startActivityForResult(intent, AUDIO_PICKER_REQUEST)
                    true
                } catch (_: Exception) {
                    pendingFileCallback?.onReceiveValue(null)
                    pendingFileCallback = null
                    false
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                if (request == null) return null
                proxyApiRequest(request)?.let { return it }
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                if (request == null || !request.isForMainFrame) return false
                val uri = request.url
                if (uri.host == ASSET_HOST) return false
                if (uri.scheme == "https" || uri.scheme == "http") {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                }
                return true
            }
        }

        // Route service-worker API fetches through the same native proxy.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
            ServiceWorkerController.getInstance().serviceWorkerClient = object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? {
                    proxyApiRequest(request)?.let { return it }
                    return assetLoader.shouldInterceptRequest(request.url)
                }
            }
        }

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        if (savedInstanceState == null) {
            webView.loadUrl(ASSET_ORIGIN + "/index.html")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    private fun proxyApiRequest(request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url
        if (uri.host != ASSET_HOST || !(uri.path ?: "").startsWith("/api/")) return null

        val apiBase = BuildConfig.VIORA_API_BASE_URL.trimEnd('/')
        if (apiBase.isBlank()) {
            return jsonResponse(503, "VIORA_API_BASE_URL is not configured")
        }
        if (request.method != "GET" && request.method != "OPTIONS") {
            return jsonResponse(405, "Method not supported by the Android API proxy")
        }

        return try {
            val target = apiBase + uri.encodedPath +
                (uri.encodedQuery?.let { "?$it" } ?: "")
            val connection = (URL(target).openConnection() as HttpURLConnection).apply {
                requestMethod = request.method
                connectTimeout = 12000
                readTimeout = 20000
                instanceFollowRedirects = true
                setRequestProperty("Accept", "application/json")
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val contentType = connection.contentType ?: "application/json"
            val mimeType = contentType.substringBefore(';').trim().ifBlank { "application/json" }
            val charset = Regex("charset=([^;]+)", RegexOption.IGNORE_CASE)
                .find(contentType)?.groupValues?.getOrNull(1)?.trim() ?: "UTF-8"
            val headers = connection.headerFields
                .filterKeys { key -> key != null && !key.equals("Transfer-Encoding", true) }
                .mapKeys { it.key!! }
                .mapValues { it.value.joinToString(",") }
            val body = stream ?: ByteArrayInputStream(ByteArray(0))
            WebResourceResponse(
                mimeType,
                charset,
                status,
                connection.responseMessage ?: "OK",
                headers,
                body
            )
        } catch (error: Exception) {
            jsonResponse(502, "VIORA API request failed: ${error.javaClass.simpleName}")
        }
    }

    private fun jsonResponse(status: Int, message: String): WebResourceResponse {
        val body = """{"error":"${message.replace("\"", "'")}"}"""
        return WebResourceResponse(
            "application/json",
            "UTF-8",
            status,
            if (status == 503) "Service Unavailable" else "Bad Gateway",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream(body.toByteArray(Charsets.UTF_8))
        )
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == AUDIO_PICKER_REQUEST) {
            val results = if (resultCode == RESULT_OK && data != null) {
                val clip = data.clipData
                when {
                    clip != null -> Array(clip.itemCount) { index -> clip.getItemAt(index).uri }
                    data.data != null -> arrayOf(data.data!!)
                    else -> emptyArray()
                }
            } else {
                emptyArray()
            }
            pendingFileCallback?.onReceiveValue(results)
            pendingFileCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        pendingFileCallback?.onReceiveValue(null)
        pendingFileCallback = null
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    private inner class AndroidInfoBridge {
        @JavascriptInterface
        fun isAndroidApp(): Boolean = true

        @JavascriptInterface
        fun getAppVersion(): String = BuildConfig.VERSION_NAME
    }

    companion object {
        private const val AUDIO_PICKER_REQUEST = 4201
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val ASSET_ORIGIN = "https://$ASSET_HOST"
    }
}
