package com.prempk.viora

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/** Native Android speech recognition adapter for the bundled WebView driving assistant. */
internal class VoiceRecognitionBridge(
    private val activity: Activity,
    private val webView: WebView
) {
    @Volatile private var recognizer: SpeechRecognizer? = null
    private var pendingLanguage: String = "en-IN"

    @JavascriptInterface
    fun isAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(activity)

    @JavascriptInterface
    fun startListening(language: String?) {
        activity.runOnUiThread {
            pendingLanguage = language?.takeIf { it.matches(Regex("[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?")) } ?: "en-IN"
            if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_CODE)
            } else {
                startNativeRecognition()
            }
        }
    }

    @JavascriptInterface
    fun stopListening() {
        activity.runOnUiThread {
            try {
                recognizer?.stopListening()
            } catch (_: Exception) {
                dispatch("viora-native-speech-end", JSONObject())
            }
        }
    }

    fun onPermissionResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != REQUEST_CODE) return false
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startNativeRecognition()
        } else {
            dispatch("viora-native-speech-error", JSONObject().put("error", "not-allowed"))
            dispatch("viora-native-speech-end", JSONObject())
        }
        return true
    }

    fun destroy() {
        activity.runOnUiThread {
            try {
                recognizer?.cancel()
                recognizer?.destroy()
            } catch (_: Exception) {
            } finally {
                recognizer = null
            }
        }
    }

    private fun startNativeRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            dispatch("viora-native-speech-error", JSONObject().put("error", "service-not-available"))
            dispatch("viora-native-speech-end", JSONObject())
            return
        }
        try {
            recognizer?.cancel()
            recognizer?.destroy()
            val speech = SpeechRecognizer.createSpeechRecognizer(activity)
            recognizer = speech
            speech.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    dispatch("viora-native-speech-state", JSONObject().put("state", "listening"))
                }
                override fun onBeginningOfSpeech() {
                    dispatch("viora-native-speech-state", JSONObject().put("state", "hearing"))
                }
                override fun onEndOfSpeech() {
                    dispatch("viora-native-speech-state", JSONObject().put("state", "processing"))
                }
                override fun onResults(results: Bundle?) {
                    val transcript = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                    if (transcript.isNotBlank()) {
                        dispatch("viora-native-speech-result", JSONObject().put("transcript", transcript))
                    } else {
                        dispatch("viora-native-speech-error", JSONObject().put("error", "no-speech"))
                    }
                    dispatch("viora-native-speech-end", JSONObject())
                }
                override fun onError(error: Int) {
                    val code = when (error) {
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
                        SpeechRecognizer.ERROR_SERVER -> "service-not-available"
                        else -> "audio"
                    }
                    dispatch("viora-native-speech-error", JSONObject().put("error", code))
                    dispatch("viora-native-speech-end", JSONObject())
                }
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, pendingLanguage)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, pendingLanguage)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.packageName)
            }
            speech.startListening(intent)
        } catch (_: Exception) {
            dispatch("viora-native-speech-error", JSONObject().put("error", "service-not-available"))
            dispatch("viora-native-speech-end", JSONObject())
        }
    }

    private fun dispatch(eventName: String, detail: JSONObject) {
        val script = "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(eventName) +
            ", { detail: " + detail.toString() + " }));"
        webView.post {
            try {
                webView.evaluateJavascript(script, null)
            } catch (_: Exception) {
            }
        }
    }

    companion object {
        const val REQUEST_CODE = 4203
    }
}
