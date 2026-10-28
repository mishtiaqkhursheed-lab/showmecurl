
package com.showme.ai

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import androidx.lifecycle.lifecycleScope
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    private val apiBase: String by lazy {
        getString(R.string.showme_api_base_url).trim().trimEnd('/')
    }

    private var usingLocalAsset = false

    private lateinit var assetLoader: androidx.webkit.WebViewAssetLoader

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.loadsImagesAutomatically = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false

        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(AndroidBridge(), "AndroidBridge")

        assetLoader = androidx.webkit.WebViewAssetLoader.Builder()
            .addPathHandler(
                "/assets/",
                androidx.webkit.WebViewAssetLoader.AssetsPathHandler(this)
            )
            .build()

        webView.webViewClient = object : WebViewClient() {

            override fun shouldInterceptRequest(
                view: WebView?,
                request: android.webkit.WebResourceRequest?
            ): android.webkit.WebResourceResponse? {
                return request?.url?.let {
                    assetLoader.shouldInterceptRequest(it)
                }
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: android.webkit.WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return true

                // Keep navigation inside the app and configured API origin.
                return !(
                    url.startsWith("https://appassets.androidplatform.net/") ||
                    (
                        apiBase.startsWith("https://") &&
                        url.startsWith("$apiBase/")
                    ) ||
                    url == apiBase
                )
            }

            override fun onReceivedError(
                view: WebView?,
                request: android.webkit.WebResourceRequest?,
                error: android.webkit.WebResourceError?
            ) {
                super.onReceivedError(view, request, error)

                if (request?.isForMainFrame == true && !usingLocalAsset) {
                    loadLocalAsset()
                }
            }
        }

        if (
            apiBase.startsWith("https://") &&
            !apiBase.contains("YOUR-SHOWME-DEPLOYMENT")
        ) {
            webView.loadUrl(apiBase)
        } else {
            loadLocalAsset()
        }
    }

    private fun loadLocalAsset() {
        if (usingLocalAsset) return

        usingLocalAsset = true

        webView.post {
            webView.loadUrl(
                "https://appassets.androidplatform.net/assets/index.html"
            )
        }
    }

    inner class AndroidBridge {

        @JavascriptInterface
        fun getApiBaseUrl(): String {
            return if (apiBase.contains("YOUR-SHOWME-DEPLOYMENT")) {
                ""
            } else {
                apiBase
            }
        }

        @JavascriptInterface
        fun signInWithGoogle() {
            runOnUiThread {
                beginGoogleSignIn()
            }
        }
    }

    private fun beginGoogleSignIn() {
        val clientId = getString(R.string.google_web_client_id)

        if (clientId.startsWith("YOUR_")) {
            callJsError(
                "Set google_web_client_id in app/src/main/res/values/strings.xml first."
            )
            return
        }

        lifecycleScope.launch {
            try {
                val option = GetGoogleIdOption.Builder()
                    .setServerClientId(clientId)
                    .setFilterByAuthorizedAccounts(false)
                    .setAutoSelectEnabled(false)
                    .build()

                val request = GetCredentialRequest.Builder()
                    .addCredentialOption(option)
                    .build()

                val result = CredentialManager
                    .create(this@MainActivity)
                    .getCredential(this@MainActivity, request)

                val google = GoogleIdTokenCredential.createFrom(
                    result.credential.data
                )

                val token = JSONObject.quote(google.idToken)

                webView.evaluateJavascript(
                    "window.onNativeGoogleIdToken && window.onNativeGoogleIdToken($token)",
                    null
                )

            } catch (e: GetCredentialException) {
                callJsError(
                    e.message ?: "Google sign-in was cancelled or failed."
                )
            } catch (e: Exception) {
                callJsError(e.message ?: "Google sign-in failed.")
            }
        }
    }

    private fun callJsError(message: String) {
        val safe = JSONObject.quote(message)

        runOnUiThread {
            webView.evaluateJavascript(
                "window.onNativeGoogleSignInError && window.onNativeGoogleSignInError($safe)",
                null
            )
        }
    }

    @Deprecated("Deprecated in Android API")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
