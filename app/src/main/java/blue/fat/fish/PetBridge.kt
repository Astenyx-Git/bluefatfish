package blue.fat.fish

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

/**
 * renderer ↔ 原生桥（addJavascriptInterface，方法在 JS 线程回调 → 主线程分发）。
 * 与 Electron preload.js 同名同义：setBounds / setInteractive；
 * openDshSite 已删（独立 APK 无 DSH 网站），新增 shellAction（菜单 → 原生壳）。
 */
class PetBridge(
    private val onBounds: (Float, Float, Float, Float) -> Unit,
    private val onInteractive: (Boolean) -> Unit,
    private val onShellAction: (String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())

    /** renderer 逐帧上报窗口包围盒（CSS px：x/y = 包围盒左上角 − 外扩余量） */
    @JavascriptInterface
    fun setBounds(x: Double, y: Double, w: Double, h: Double) {
        main.post { onBounds(x.toFloat(), y.toFloat(), w.toFloat(), h.toFloat()) }
    }

    /** renderer 菜单开合 → 交互窗扩缩（true=扩到整窗盖住菜单，false=收回身体命中区） */
    @JavascriptInterface
    fun setInteractive(flag: Boolean) {
        main.post { onInteractive(flag) }
    }

    /** 菜单壳级动作：shell-settings / shell-exit（toggle-pause 由 renderer 内部处理） */
    @JavascriptInterface
    fun shellAction(name: String) {
        main.post { onShellAction(name) }
    }
}
