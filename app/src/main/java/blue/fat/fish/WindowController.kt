package blue.fat.fish

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.webkit.WebView
import kotlin.math.roundToInt

/**
 * 双悬浮窗控制器：
 *   视觉窗（WebView，FLAG_NOT_TOUCHABLE）= 宠物全画布 + 菜单 DOM；
 *   交互窗（GestureRelayView）= 身体命中区（菜单/拖拽期临时扩到整窗）。
 *
 * 几何与上游 renderer.js 严格同源：
 *   窗口 = 宠物包围盒 + 四周 0.12×size 余量（renderer fork 的 WINDOW_MARGIN_RATIO）；
 *   身体命中区 = 窗口内 (margin + HIT_BOX 比例×size)，窗口尺寸由 renderer 逐帧 setBounds 上报
 *   （CSS px），壳按 density 换算成屏幕 px 摆窗。
 */
class WindowController(private val context: Context) {
    companion object {
        // 与上游 src/shared/constants.ts 同源
        private const val CANVAS_W = 640.0
        private const val CANVAS_H = 360.0
        private const val FEET_Y = 330.0
        private const val HIT_X0 = 200.0
        private const val HIT_Y0 = 50.0
        private const val HIT_X1 = 440.0
        private const val HIT_Y1 = 335.0
        // 与 renderer fork 后的 WINDOW_MARGIN_RATIO 保持一致
        private const val MARGIN_RATIO = 0.12
        private const val DEFAULT_SIZE_CSS = 180.0
    }

    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val mainHandler = Handler(Looper.getMainLooper())

    private var density = 1f
    private var viewportW = 0f // 全屏宽（CSS px，renderer 视口）
    private var viewportH = 0f // 全屏高（CSS px；手势区由 renderer 经 gestureInset 自行扣减）
    private var gestureInset = 0f

    private lateinit var webHost: PetWebViewHost
    private lateinit var visual: WebView
    private lateinit var touch: GestureRelayView

    // 视觉窗（屏幕 px，renderer setBounds 驱动）
    private var vx = 0
    private var vy = 0
    private var vw = 0
    private var vh = 0
    private var menuExpanded = false // renderer 菜单开合（setInteractive）
    private var dragExpanded = false // 拖拽/长按期（relay 驱动）
    private var started = false

    fun start() {
        if (started) return
        started = true
        val real = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(real)
        density = real.density
        viewportW = real.widthPixels / density
        viewportH = real.heightPixels / density
        // 底部导航/手势条高度（简化：导航栏资源；P2 换 WindowInsets 精确值）
        val navId = context.resources.getIdentifier("navigation_bar_height", "dimen", "android")
        gestureInset = if (navId > 0) context.resources.getDimensionPixelSize(navId) / density else 0f

        val bridge = PetBridge(
            onBounds = { x, y, w, h -> updateBounds(x, y, w, h) },
            onInteractive = { expand ->
                menuExpanded = expand
                mainHandler.post { layoutTouch() }
            },
            onShellAction = { action -> handleShellAction(action) },
        )
        webHost = PetWebViewHost(context, bridge)
        visual = webHost.create(viewportW, viewportH, gestureInset)

        touch = GestureRelayView(
            context,
            toClient = { rawX, rawY ->
                // 视觉窗视口 CSS px（与窗口移动解耦：raw 恒定 → client 稳定，renderer 只用增量也安全）
                floatArrayOf((rawX - vx) / density, (rawY - vy) / density)
            },
            toScreen = { raw ->
                // 全局屏幕 CSS px（renderer 拖拽用 e.screenX 增量定位；语义同 Electron）
                raw / density
            },
            eval = { js -> mainHandler.post { webHost.eval(js) } },
            onRequestInteractive = { expand ->
                dragExpanded = expand
                mainHandler.post { layoutTouch() }
            },
            isMenuOpen = { menuExpanded },
        )

        // 初始估算尺寸（renderer 首帧 setBounds 立即精确覆盖，仅避免启动瞬间闪跳）
        val estW = DEFAULT_SIZE_CSS * (1 + 2 * MARGIN_RATIO)
        val estH = DEFAULT_SIZE_CSS * 9.0 / 16.0 * (1 + (CANVAS_H - FEET_Y) / CANVAS_H) + 2 * DEFAULT_SIZE_CSS * MARGIN_RATIO
        vw = (estW * density).roundToInt()
        vh = (estH * density).roundToInt()
        vx = ((viewportW - estW - 8.0) * density).roundToInt()
        vy = (48 * density).roundToInt()
        wm.addView(visual, visualParams())
        wm.addView(touch, touchParamsSized(vw, vh))
    }

    fun destroy() {
        if (!started) return
        started = false
        try { wm.removeView(visual) } catch (_: Exception) {}
        try { wm.removeView(touch) } catch (_: Exception) {}
        webHost.destroy()
    }

    /** renderer setBounds（CSS px）→ 屏幕 px 摆窗 */
    private fun updateBounds(x: Float, y: Float, w: Float, h: Float) {
        vx = Math.round(x * density)
        vy = Math.round(y * density)
        vw = Math.round(w * density)
        vh = Math.round(h * density)
        mainHandler.post {
            if (!started) return@post
            try {
                wm.updateViewLayout(visual, visualParams())
            } catch (_: Exception) {}
            layoutTouch()
        }
    }

    /** 交互窗摆放：扩窗（菜单/拖拽）= 整个视觉窗矩形；常态 = 身体命中区 */
    private fun layoutTouch() {
        if (!started || vw <= 0) return
        try {
            if (menuExpanded || dragExpanded) {
                wm.updateViewLayout(touch, touchParamsFull())
            } else {
                val r = bodyRectCss() ?: return
                val p = touchParamsSized(
                    Math.round(r[2].toFloat() * density),
                    Math.round(r[3].toFloat() * density),
                )
                p.x = vx + Math.round(r[0].toFloat() * density)
                p.y = vy + Math.round(r[1].toFloat() * density)
                wm.updateViewLayout(touch, p)
            }
        } catch (_: Exception) {}
    }

    /**
     * 身体命中区在视觉窗内的矩形（CSS px）。
     * 窗口尺寸反推：winW = size×(1+2r)、winH = height×(1+bottomPad比例) + 2×margin，
     * 与 renderer sendBounds 的公式互逆。
     */
    private fun bodyRectCss(): DoubleArray? {
        if (vw <= 0 || vh <= 0) return null
        val winW = vw / density
        val winH = vh / density
        val size = winW / (1 + 2 * MARGIN_RATIO)
        val margin = size * MARGIN_RATIO
        val height = (winH - 2 * margin) * CANVAS_H / (CANVAS_H + (CANVAS_H - FEET_Y))
        val bottomPad = height * (CANVAS_H - FEET_Y) / CANVAS_H
        val x = margin + size * HIT_X0 / CANVAS_W
        val y = margin + bottomPad + height * HIT_Y0 / CANVAS_H
        val w = size * (HIT_X1 - HIT_X0) / CANVAS_W
        val h = height * (HIT_Y1 - HIT_Y0) / CANVAS_H
        return doubleArrayOf(x, y, w, h)
    }

    private fun overlayParams(wPx: Int, hPx: Int): WindowManager.LayoutParams =
        WindowManager.LayoutParams(
            wPx, hPx,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = vx
            y = vy
        }

    @SuppressLint("WrongConstant")
    private fun visualParams(): WindowManager.LayoutParams =
        overlayParams(vw, vh).apply {
            flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        }

    private fun touchParamsFull(): WindowManager.LayoutParams = overlayParams(vw, vh)

    private fun touchParamsSized(wPx: Int, hPx: Int): WindowManager.LayoutParams = overlayParams(wPx, hPx)

    /** 控制台与菜单共用的暂停/恢复（renderer 内部实现：暂停视频 + 停 rAF 驱动） */
    fun togglePause() {
        mainHandler.post { webHost.eval("sprites.forEach(function(s){s.togglePause()})") }
    }

    private fun handleShellAction(action: String) {
        when (action) {
            "shell-settings" -> context.startActivity(
                Intent(context, ConsoleActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            "shell-exit" -> context.stopService(Intent(context, PetService::class.java))
            "toggle-pause" -> togglePause()
        }
    }
}
