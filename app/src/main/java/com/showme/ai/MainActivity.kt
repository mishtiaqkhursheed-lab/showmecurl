package com.showme.ai

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
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

        // Handle deep link if app was cold-started from the OAuth callback
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // App was already running; handle the deep link return from browser
        handleIntent(intent)
    }

    /**
     * Called on cold start (onCreate) and hot return (onNewIntent).
     * Looks for the showme://callback URI that Supabase redirects to after
     * Google OAuth, extracts the fragment (which contains access_token etc.),
     * and forwards it into the WebView so the JS auth layer can create a
     * Supabase session from it.
     */
    private fun handleIntent(intent: Intent?) {
        val data: Uri = intent?.data ?: return
        if (data.scheme != "showme" || data.host != "callback") return

        // Supabase implicit flow: tokens arrive in the URL fragment
        // showme://callback#access_token=...&refresh_token=...
        val fragment = data.fragment ?: ""

        // Supabase PKCE flow: auth code arrives as a query param
        // showme://callback?code=...
        val code = data.getQueryParameter("code") ?: ""

        if (fragment.isBlank() && code.isBlank()) return

        Log.d("ShowMeOAuth", "Deep link received, fragment=${fragment.length}, code=${code.length}")

        webView.postDelayed({
            if (fragment.isNotBlank()) {
                val safeFragment = JSONObject.quote(fragment)
                webView.evaluateJavascript(
                    "window.onOAuthCallback && window.onOAuthCallback($safeFragment, null)",
                    null
                )
            } else {
                val safeCode = JSONObject.quote(code)
                webView.evaluateJavascript(
                    "window.onOAuthCallback && window.onOAuthCallback(null, $safeCode)",
                    null
                )
            }
        }, 600)
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

        /**
         * Opens Google OAuth in an external Chrome Custom Tab.
         * The redirectTo must be the deep-link URI registered in AndroidManifest
         * AND added as an allowed redirect URL in your Supabase dashboard:
         *   showme://callback
         */
        @JavascriptInterface
        fun openGoogleOAuth(oauthUrl: String) {
            runOnUiThread {
                try {
                    val uri = Uri.parse(oauthUrl)
                    val customTab = CustomTabsIntent.Builder()
                        .setShowTitle(false)
                        .build()
                    customTab.launchUrl(this@MainActivity, uri)
                } catch (e: Exception) {
                    Log.e("ShowMeOAuth", "Failed to open Custom Tab", e)
                    callJsError("Could not open browser for Google sign-in: ${e.message}")
                }
            }
        }

        // Keep for backwards compatibility (unused now but harmless)
        @JavascriptInterface
        fun signInWithGoogle() {
            callJsError(
                "Native Google sign-in is no longer supported. " +
                "Please use the browser flow."
            )
        }
    }

    private fun callJsError(message: String) {
        val safe = JSONObject.quote(message)

        runOnUiThread {
            webView.evaluateJavascript(
                "window.onNativeGoogleSignInError && " +
                    "window.onNativeGoogleSignInError($safe)",
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
