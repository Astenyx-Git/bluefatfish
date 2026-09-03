package blue.fat.fish

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import blue.fat.fish.clock.RuntimeLedger
import blue.fat.fish.clock.RuntimeLedgerStore
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
        // [dsh-pet-android] 左右余量另加 1/3 宠物宽（0.12 + 1/3 ≈ 0.4533；与 renderer fork 的 margin.l/r 同步）
        private const val MARGIN_RATIO_X = MARGIN_RATIO + 1.0 / 3.0
        // 运行时长账本周期落盘间隔
        private const val FLUSH_INTERVAL_MS = 60_000L
        private const val DEFAULT_SIZE_CSS = 180.0
    }

    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val mainHandler = Handler(Looper.getMainLooper())

    private var density = 1f
    private var realW = 0f // 物理屏宽（CSS px）
    private var realH = 0f // 物理屏高（CSS px）
    private var navL = 0f // 导航条左缘宽（CSS px；横屏可能侧置，由 insets 回调修正）
    private var navR = 0f // 导航条右缘宽
    private var navB = 0f // 导航条底缘高（竖屏）
    private var wsX = 0f // 工作区原点 X（CSS px；= 导航条左缘，renderer 坐标保持 0 基）
    private var wsY = 0f // 工作区原点 Y：恒 0 —— 透明状态栏下上边框对齐物理屏（既定需求）
    private var lastRotation = 0 // 上次 display rotation（0/1/2/3，用于物理位换算）
    private var viewportW = 0f // 工作区宽（CSS px，renderer 视口）
    private var viewportH = 0f // 工作区高

    private lateinit var webHost: PetWebViewHost
    private lateinit var visual: WebView
    private lateinit var touch: GestureRelayView

    // 视觉窗（屏幕 px，renderer setBounds 驱动）
    private var vx = 0
    private var vy = 0
    private var vw = 0
    private var vh = 0
    // [dsh-pet-android] 亚像素累加：逐帧取整的余量进位到下一帧，
    // 低速蠕行段（每帧位移 < 1 物理像素）消除"停两帧跳一像素"的量化抖动
    private var carryX = 0f
    private var carryY = 0f
    // [dsh-pet-android] 累计运行时长账本（Swift PetRuntimeClock 逻辑；悬浮窗存在即计时，暂停动画同计）
    private val ledgerStore = RuntimeLedgerStore(context)
    private val ledger = RuntimeLedger(ledgerStore.load())
    private val flushRunnable = object : Runnable {
        override fun run() {
            val n = nowSec()
            ledger.pause(n) // 结账→落盘→重新开账（崩溃最多丢一个周期）
            ledgerStore.save(RuntimeLedgerStore.SCOPE_DEVICE, ledger)
            ledger.resume(n)
            mainHandler.postDelayed(this, FLUSH_INTERVAL_MS)
        }
    }

    private fun nowSec(): Double = SystemClock.elapsedRealtime() / 1000.0

    /** 重算物理屏度量 + 导航条预估（精确值由 visual 的 insets 回调修正；首次前用导航栏资源兜底） */
    private fun refreshDisplayMetrics() {
        val real = android.util.DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(real)
        density = real.density
        realW = real.widthPixels / density
        realH = real.heightPixels / density
        if (navL == 0f && navR == 0f && navB == 0f) {
            val navId = context.resources.getIdentifier("navigation_bar_height", "dimen", "android")
            navB = if (navId > 0) context.resources.getDimensionPixelSize(navId) / density else 0f
        }
        applyWorkspace()
    }

    /** 导航条真实位置 → 工作区：宽扣左右缘、高扣底缘、原点=左缘。
     *  尺寸变化只 eval 改 renderer 的 VIEW（不搬宠物、不重载页面——reload 真机实测 = 闪烁）。
     *  宠物物理位保持仅在真实横竖屏切换时由 onDisplayChanged 完成。 */
    private fun applyWorkspace() {
        if (realW <= 0f) return
        val newW = realW - navL - navR
        val newH = realH - navB
        val changed = kotlin.math.abs(newW - viewportW) >= 0.5f ||
            kotlin.math.abs(newH - viewportH) >= 0.5f
        viewportW = newW
        viewportH = newH
        wsX = navL
        wsY = 0f
        if (changed && started && this::webHost.isInitialized) {
            mainHandler.post {
                webHost.eval("VIEW.w=" + viewportW + ";VIEW.h=" + viewportH + ";")
            }
        }
    }

    /** [dsh-pet-android] 横竖屏/显示配置变化。同方向（inset 修正）：只改度量不动宠物；
     *  真实旋转：宠物包围盒左上经 natural 坐标系换算到新方向（保持屏幕物理位置），越界夹取。 */
    fun onDisplayChanged() {
        if (!started) return
        val oldRotation = lastRotation
        if (wm.defaultDisplay.rotation == oldRotation) {
            refreshDisplayMetrics()
            return
        }
        val oldDensity = density
        val oldWpx = realW * oldDensity
        val oldHpx = realH * oldDensity
        val winWCss = vw / oldDensity
        val size = winWCss / (1 + 2 * MARGIN_RATIO_X)
        val ax0 = vx + size * MARGIN_RATIO_X * oldDensity // 宠物包围盒左上（旧方向 device px）
        val ay0 = vy + size * MARGIN_RATIO * oldDensity
        refreshDisplayMetrics()
        val newRotation = wm.defaultDisplay.rotation
        lastRotation = newRotation
        // 旧方向 → natural（Surface.rotation 约定的标准映射）
        val nat = when (oldRotation % 4) {
            1 -> Pair(oldHpx - ay0, ax0)
            3 -> Pair(ay0, oldWpx - ax0)
            2 -> Pair(oldWpx - ax0, oldHpx - ay0)
            else -> Pair(ax0, ay0)
        }
        // natural → 新方向
        val abs = when (newRotation % 4) {
            1 -> Pair(nat.second, realH * density - nat.first)
            3 -> Pair(realW * density - nat.second, nat.first)
            2 -> Pair(realW * density - nat.first, realH * density - nat.second)
            else -> nat
        }
        val tx = (abs.first / density - wsX).coerceIn(0.0, (viewportW - size).coerceAtLeast(0.0))
        val ty = (abs.second / density - wsY).coerceIn(0.0, (viewportH - size * 9.0 / 16.0).coerceAtLeast(0.0))
        mainHandler.post {
            webHost.eval("__dshPetSetPosition(" + tx + "," + ty + ");")
        }
    }
    private var menuExpanded = false // renderer 菜单开合（setInteractive）
    private var dragExpanded = false // 拖拽/长按期（relay 驱动）
    private var started = false

    fun start() {
        if (started) return
        started = true
        refreshDisplayMetrics()
        lastRotation = wm.defaultDisplay.rotation
        ledger.resume(nowSec())
        mainHandler.postDelayed(flushRunnable, FLUSH_INTERVAL_MS)

        val bridge = PetBridge(
            onBounds = { x, y, w, h -> updateBounds(x, y, w, h) },
            onInteractive = { expand ->
                menuExpanded = expand
                mainHandler.post { layoutTouch() }
            },
            onShellAction = { action -> handleShellAction(action) },
        )
        webHost = PetWebViewHost(context, bridge)
        visual = webHost.create(viewportW, viewportH)
        // 导航条真实位置/尺寸回修：insets 按边读取（横屏侧置时原点/宽高随之修正）
        visual.setOnApplyWindowInsetsListener { _, insets ->
            val d = density
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                val nav = insets.getInsets(android.view.WindowInsets.Type.navigationBars())
                navL = nav.left / d
                navR = nav.right / d
                navB = nav.bottom / d
            } else {
                @Suppress("DEPRECATION")
                run {
                    navL = insets.systemWindowInsetLeft / d
                    navR = insets.systemWindowInsetRight / d
                    navB = insets.systemWindowInsetBottom / d
                }
            }
            applyWorkspace()
            insets
        }

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
        val estW = DEFAULT_SIZE_CSS * (1 + 2 * MARGIN_RATIO_X)
        val estH = DEFAULT_SIZE_CSS * 9.0 / 16.0 * (1 + (CANVAS_H - FEET_Y) / CANVAS_H) + 2 * DEFAULT_SIZE_CSS * MARGIN_RATIO
        vw = (estW * density).roundToInt()
        vh = (estH * density).roundToInt()
        vx = ((wsX + viewportW - estW - 8.0) * density).roundToInt()
        vy = ((wsY + viewportH - estH) * density).roundToInt() - vh
        wm.addView(visual, visualParams())
        wm.addView(touch, touchParamsSized(vw, vh))
    }

    fun destroy() {
        if (!started) return
        started = false
        mainHandler.removeCallbacks(flushRunnable)
        ledger.pause(nowSec())
        ledgerStore.save(RuntimeLedgerStore.SCOPE_DEVICE, ledger)
        try { wm.removeView(visual) } catch (_: Exception) {}
        try { wm.removeView(touch) } catch (_: Exception) {}
        webHost.destroy()
    }

    /** renderer setBounds（CSS px）→ 屏幕 px 摆窗 */
    private fun updateBounds(x: Float, y: Float, w: Float, h: Float) {
        val fx = (x + wsX) * density + carryX
        val fy = (y + wsY) * density + carryY
        vx = Math.round(fx)
        vy = Math.round(fy)
        carryX = fx - vx
        carryY = fy - vy
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
        val size = winW / (1 + 2 * MARGIN_RATIO_X)
        val marginX = size * MARGIN_RATIO_X
        val marginT = size * MARGIN_RATIO
        val height = (winH - 2 * marginT) * CANVAS_H / (CANVAS_H + (CANVAS_H - FEET_Y))
        val bottomPad = height * (CANVAS_H - FEET_Y) / CANVAS_H
        val x = marginX + size * HIT_X0 / CANVAS_W
        val y = marginT + bottomPad + height * HIT_Y0 / CANVAS_H
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
            // [dsh-pet-android] 不吃任何系统 inset（状态栏/挖孔/导航均由 renderer 自行管理）：
            // 透明状态栏下窗口原点 = 物理屏顶，而不是状态栏/挖孔下缘；底部上界同样自主控制
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                fitInsetsTypes = 0
            }
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

    /** 控制台实时参数注入（重力倍率等） */
    fun evalJs(js: String) {
        mainHandler.post { webHost.eval(js) }
    }

    /** 累计运行时长（毫秒，实时含未结账锚点）——控制台展示用 */
    fun runtimeTotalMs(): Double = ledger.runningTotal(nowSec())

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
