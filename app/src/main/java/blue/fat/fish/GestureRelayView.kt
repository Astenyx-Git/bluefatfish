package blue.fat.fish

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration

/**
 * 交互窗本体（原生 View，不进 WebView）：
 *   常态覆盖宠物身体命中区；拖拽/菜单期扩到整视觉窗。
 *
 * 手势仲裁（与产品定稿一致：按下即拖）：
 *   按下 → 位移 > touchSlop = 拖拽（取消长按计时，扩窗，合成 pointerdown/move/up）；
 *   静置 ≥ 系统长按时长 = 菜单（震动 + 合成 contextmenu）；
 *   菜单开启后：点按分支 = 展开其子面板（shim 转译为 mouseenter）；点叶子 = 激活；滑动 = 合成滚动；
 *   纯点击 = pointerdown → pointerup → click（renderer 播点击回应 + Q 弹）。
 *
 * 坐标：全部用 getRawX/Y 换算成视觉窗视口 CSS px——与交互窗自身 bounds 漂移无关。
 */
class GestureRelayView(
    context: Context,
    private val toClient: (rawX: Float, rawY: Float) -> FloatArray,
    private val toScreen: (raw: Float) -> Float,
    private val eval: (String) -> Unit,
    private val onRequestInteractive: (Boolean) -> Unit,
    private val isMenuOpen: () -> Boolean,
) : View(context) {

    private var downRawX = 0f
    private var downRawY = 0f
    private var lastRawX = 0f
    private var lastRawY = 0f
    private var dragged = false
    private var longPressFired = false
    private var menuOpenOnDown = false
    private var menuScrolling = false
    private var menuScrollAccum = 0f

    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private val longPressMs = ViewConfiguration.getLongPressTimeout().toLong()
    private val handler = Handler(Looper.getMainLooper())

    private val longPressRunnable = Runnable {
        if (dragged || menuOpenOnDown) return@Runnable
        longPressFired = true
        android.util.Log.i("dshpet", "long-press fired -> contextmenu ($lastRawX,$lastRawY)")
        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        sendAt("contextmenu", lastRawX, lastRawY)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                android.util.Log.i("dshpet", "touch DOWN raw=(${event.rawX},${event.rawY})")
                downRawX = event.rawX
                downRawY = event.rawY
                lastRawX = downRawX
                lastRawY = downRawY
                dragged = false
                longPressFired = false
                menuOpenOnDown = isMenuOpen()
                menuScrolling = false
                menuScrollAccum = 0f
                if (menuOpenOnDown) {
                    // 菜单已开：本次按下不派发任何事件——触屏绝不能 hover 展开
                    // （子面板若在指尖下展开，抬手 tap 会点中更深一层的项 = 误触链）
                } else {
                    handler.postDelayed(longPressRunnable, longPressMs)
                }
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = event.rawX - downRawX
                val dy = event.rawY - downRawY
                if (!dragged && !menuOpenOnDown && !longPressFired && dx * dx + dy * dy > slop.toFloat() * slop) {
                    handler.removeCallbacks(longPressRunnable)
                    dragged = true
                    onRequestInteractive(true) // 拖拽期扩窗：手指始终被跟踪
                    sendAt("pointerdown", downRawX, downRawY)
                }
                if (dragged) {
                    sendAt("pointermove", event.rawX, event.rawY)
                } else if (menuOpenOnDown || longPressFired) {
                    // 菜单态：滑动 = 滚动子面板（视觉窗不可触摸，原生滚动永不存在，必须合成）
                    val dy = event.rawY - lastRawY
                    menuScrollAccum += dy
                    if (!menuScrolling && kotlin.math.abs(menuScrollAccum) > slop) menuScrolling = true
                    if (menuScrolling && kotlin.math.abs(dy) >= 1f) sendScroll(event.rawX, event.rawY, dy)
                }
                lastRawX = event.rawX
                lastRawY = event.rawY
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                handler.removeCallbacks(longPressRunnable)
                val isUp = event.actionMasked == MotionEvent.ACTION_UP
                if (dragged) {
                    sendAt("pointerup", event.rawX, event.rawY)
                    onRequestInteractive(false)
                } else if (menuOpenOnDown) {
                    // 菜单已开时的点按：叶子激活 / 点外关闭（滑动滚动后抬手不触发点击）
                    if (isUp && !menuScrolling) sendAt("tap", event.rawX, event.rawY)
                } else if (longPressFired) {
                    // 长按开菜单后的抬手：吞掉，不产生点击
                } else if (isUp) {
                    // 纯点击：pointerdown → pointerup → click
                    sendAt("pointerdown", downRawX, downRawY)
                    sendAt("pointerup", event.rawX, event.rawY)
                    sendAt("tap", event.rawX, event.rawY)
                }
                dragged = false
                longPressFired = false
                menuOpenOnDown = false
                menuScrolling = false
                menuScrollAccum = 0f
            }
        }
        return true
    }

    /** 合成事件：x/y = 视口 CSS px；sx/sy = 全局屏幕 CSS px（renderer 拖拽增量用它，
     *  语义同 Electron MouseEvent.screenX——绝不能含随窗口移动的成分，否则拖拽半速） */
    private fun sendAt(type: String, rawX: Float, rawY: Float) {
        val p = toClient(rawX, rawY)
        eval("window.__dshPetSynthetic('" + type + "'," + p[0] + "," + p[1] + "," +
            toScreen(rawX) + "," + toScreen(rawY) + ")")
    }

    /** 菜单态滚动：dy = 本次 move 的 rawY 增量（手指下移为正 → 内容上滚） */
    private fun sendScroll(rawX: Float, rawY: Float, dy: Float) {
        val p = toClient(rawX, rawY)
        eval("window.__dshPetSynthetic('menuscroll'," + p[0] + "," + p[1] + "," + dy + ")")
    }
}
