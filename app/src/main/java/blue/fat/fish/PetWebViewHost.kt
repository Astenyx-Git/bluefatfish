package blue.fat.fish

import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * 视觉窗 WebView 宿主：
 *  - WebViewAssetLoader 把 https://appassets.androidplatform.net/assets/ 前缀映射到 APK assets，
 *    renderer 的 https 形态 URL（fetch/video/font）零改动可跑；
 *  - 透明背景 + 免手势自动播放 + 固定 textZoom（系统字体缩放会破坏 CSS px 几何）；
 *  - 注入 AndroidPetBridge（renderer 内 bridge-shim.js 包装为 window.petBridge）。
 */
class PetWebViewHost(private val context: Context, private val bridge: PetBridge) {
    private var webView: WebView? = null

    fun create(viewportW: Float, viewportH: Float, gestureInset: Float): WebView {
        val wv = WebView(context)
        webView = wv
        wv.setBackgroundColor(Color.TRANSPARENT)
        wv.overScrollMode = View.OVER_SCROLL_NEVER
        wv.settings.apply {
            javaScriptEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_NO_CACHE
            textZoom = 100
            useWideViewPort = false
            loadWithOverviewMode = false
        }
        // [dsh-pet-android] 关闭算法暗化：系统深色模式会把页面透明底与菜单白面板染成暗色
        // （真机实测 OneUI 复现）；宠物页自管配色。API 33+ 的算法暗化是深色模式染色的现役
        // 机制；29-32 的 forceDark 已从 SDK 36 stubs 移除无法编译，且 minSdk 26 的老系统
        // 无此染色行为——不再分叉兼容。
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            wv.settings.isAlgorithmicDarkeningAllowed = false
        }
        wv.addJavascriptInterface(bridge, "AndroidPetBridge")
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", AssetHandler(context))
            .build()
        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
        }
        val configUrl = "https://appassets.androidplatform.net/assets/config.jsonc"
        val url = "https://appassets.androidplatform.net/assets/index.html" +
            "?configUrl=" + Uri.encode(configUrl) +
            "&workAreaW=" + viewportW.toInt() +
            "&workAreaH=" + viewportH.toInt() +
            "&gestureInset=" + gestureInset.toInt() +
            "&scale=1&petIndex=0"
        wv.loadUrl(url)
        return wv
    }

    /** 主线程 JS 注入（合成事件 / 暂停控制）；调用方负责已在主线程或自行 post */
    fun eval(js: String) {
        webView?.evaluateJavascript(js, null)
    }

    fun destroy() {
        webView?.destroy()
        webView = null
    }

    /**
     * assets 映射 + 显式 MIME 兜底：webm/jsonc/ttf 在部分系统 MimeMap 上猜型失败，
     * 视频会被当 text/plain 拒播，这里按扩展名固定。
     */
    private class AssetHandler(context: Context) : WebViewAssetLoader.PathHandler {
        private val delegate = WebViewAssetLoader.AssetsPathHandler(context)

        override fun handle(path: String): WebResourceResponse? {
            val resp = delegate.handle(path) ?: return null
            val ext = path.substringAfterLast('.', "").lowercase()
            val mime = when (ext) {
                "webm" -> "video/webm"
                "jsonc", "json" -> "application/json"
                "ttf" -> "font/ttf"
                "html" -> "text/html"
                "js" -> "text/javascript"
                "css" -> "text/css"
                else -> return resp
            }
            val charset = if (mime.startsWith("text/") || mime == "application/json") "utf-8" else null
            return WebResourceResponse(mime, charset, resp.data)
        }
    }
}
