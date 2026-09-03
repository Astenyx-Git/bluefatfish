package blue.fat.fish

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.util.Linkify
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import blue.fat.fish.clock.RuntimeLedgerStore

/**
 * APK 本体 = 三态控制台（系统全局字体 + Material 原生组件）：
 *   ① 首启无权限：权限解释页 → 直达系统悬浮窗开关 → 返回自动拉起服务
 *   ② 运行中：状态卡 + 启动/暂停/退出 + 自启开关
 *   ③ 异常（服务被杀/权限被关）：状态标红 + 重新启动入口
 * 关闭本页 ≠ 停宠物（Activity 只是遥控器）。
 */
class ConsoleActivity : Activity() {
    private lateinit var statusView: TextView
    private lateinit var guideBlock: LinearLayout
    private lateinit var controlsBlock: LinearLayout
    private lateinit var pauseBtn: Button
    private lateinit var autostartSwitch: Switch

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val d = resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val pad = dp(20)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, dp(32), pad, pad)
        }
        root.addView(
            TextView(this).apply {
                text = getString(R.string.app_name)
                textSize = 26f
                gravity = Gravity.CENTER
                typeface = Typeface.createFromAsset(assets, "fonts/上首软糖体.ttf") // 标题软糖体
            },
        )
        statusView = TextView(this).apply {
            textSize = 15f
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(12))
        }
        guideBlock = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(
                TextView(this@ConsoleActivity).apply {
                    text = getString(R.string.guide_title)
                    textSize = 18f
                    setPadding(0, dp(24), 0, dp(8))
                },
            )
            addView(
                TextView(this@ConsoleActivity).apply {
                    text = getString(R.string.guide_body)
                    textSize = 14f
                    setLineSpacing(0f, 1.2f)
                },
            )
            addView(
                Button(this@ConsoleActivity).apply {
                    text = getString(R.string.guide_button)
                    setOnClickListener { openOverlaySettings() }
                },
            )
        }
        controlsBlock = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(
                Button(this@ConsoleActivity).apply {
                    text = getString(R.string.btn_start)
                    setOnClickListener { requestNotificationsAndStart() }
                },
            )
            pauseBtn = Button(this@ConsoleActivity).apply {
                text = "暂停 / 恢复动画"
                setOnClickListener { togglePause() }
            }
            addView(pauseBtn)
            addView(
                Button(this@ConsoleActivity).apply {
                    text = getString(R.string.btn_exit)
                    setOnClickListener {
                        PetService.requestStop(this@ConsoleActivity) // 乐观翻转：UI 不等异步销毁
                        refresh()
                        refreshSoon()
                    }
                },
            )
            autostartSwitch = Switch(this@ConsoleActivity).apply {
                text = getString(R.string.autostart_label)
                isChecked = prefs().getBoolean(KEY_AUTOSTART, false)
                // [dsh-pet-android] 主题色统一 #66ccff：选中态着色，未选中介灰（SeekBar/链接已同色）
                val accent = Color.parseColor("#66ccff")
                val states = arrayOf(
                    intArrayOf(android.R.attr.state_checked),
                    intArrayOf(),
                )
                thumbTintList = ColorStateList(states, intArrayOf(accent, Color.parseColor("#B0BEC5")))
                trackTintList = ColorStateList(states, intArrayOf(Color.parseColor("#5566CCFF"), Color.parseColor("#33B0BEC5")))
                setOnCheckedChangeListener { _, checked ->
                    prefs().edit().putBoolean(KEY_AUTOSTART, checked).apply()
                }
            }
            addView(autostartSwitch)
            // [dsh-pet-android] 累计运行时长（Swift RuntimeLedger 账本，设备维度）：前台每秒实时刷新
            runtimeLabel = TextView(this@ConsoleActivity).apply {
                textSize = 13f
                setPadding(0, dp(14), 0, 0)
            }
            addView(runtimeLabel)
            // [dsh-pet-android] 重力拖动条：左小右大（0 / 0.3 / 0.5 / 0.7 / 1.0），松手即实时注入 renderer
            val gravityValues = floatArrayOf(0f, 0.3f, 0.5f, 0.7f, 1f)
            val savedG = prefs().getFloat(PetService.KEY_GRAVITY_MULT, 1f)
            val initialIdx = gravityValues.indexOfFirst { it == savedG }.let { if (it < 0) 4 else it }
            val gravityLabel = TextView(this@ConsoleActivity).apply {
                text = gravityText(gravityValues[initialIdx])
                textSize = 14f
                setPadding(0, dp(16), 0, dp(4))
            }
            addView(gravityLabel)
            addView(
                SeekBar(this@ConsoleActivity).apply {
                    max = 4
                    progress = initialIdx
                    progressTintList = ColorStateList.valueOf(Color.parseColor("#66ccff"))
                    thumbTintList = ColorStateList.valueOf(Color.parseColor("#66ccff"))
                    setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                        override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) {
                            gravityLabel.text = gravityText(gravityValues[p])
                        }

                        override fun onStartTrackingTouch(sb: SeekBar?) {}

                        override fun onStopTrackingTouch(sb: SeekBar?) {
                            val v = gravityValues[progress]
                            prefs().edit().putFloat(PetService.KEY_GRAVITY_MULT, v).apply()
                            startService(
                                Intent(this@ConsoleActivity, PetService::class.java)
                                    .setAction(PetService.ACTION_SET_GRAVITY)
                                    .putExtra("gm", v),
                            )
                        }
                    })
                },
            )
            // [dsh-pet-android] 阻力拖动条：1.0×-5.0×，乘算于各重力档位的基础阻力（__dshPetDragScale）之上
            val dragValues = floatArrayOf(1f, 2f, 3f, 4f, 5f)
            val savedD = prefs().getFloat(PetService.KEY_DRAG_MULT, 1f)
            val initialD = dragValues.indexOfFirst { it == savedD }.let { if (it < 0) 0 else it }
            val dragLabel = TextView(this@ConsoleActivity).apply {
                text = "空气阻力 ×" + dragValues[initialD]
                textSize = 14f
                setPadding(0, dp(16), 0, dp(4))
            }
            addView(dragLabel)
            addView(
                SeekBar(this@ConsoleActivity).apply {
                    max = 4
                    progress = initialD
                    progressTintList = ColorStateList.valueOf(Color.parseColor("#66ccff"))
                    thumbTintList = ColorStateList.valueOf(Color.parseColor("#66ccff"))
                    setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                        override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) {
                            dragLabel.text = "空气阻力 ×" + dragValues[p]
                        }

                        override fun onStartTrackingTouch(sb: SeekBar?) {}

                        override fun onStopTrackingTouch(sb: SeekBar?) {
                            val v = dragValues[progress]
                            prefs().edit().putFloat(PetService.KEY_DRAG_MULT, v).apply()
                            startService(
                                Intent(this@ConsoleActivity, PetService::class.java)
                                    .setAction(PetService.ACTION_SET_DRAG)
                                    .putExtra("dm", v),
                            )
                        }
                    })
                },
            )
        }
        root.addView(statusView)
        root.addView(guideBlock)
        root.addView(controlsBlock)
        root.addView(
            TextView(this).apply {
                text = getString(R.string.about_text)
                textSize = 12f
                gravity = Gravity.CENTER
                setPadding(0, dp(24), 0, 0)
                Linkify.addLinks(this, Linkify.WEB_URLS) // 原项目地址可点
                setLinkTextColor(Color.parseColor("#66ccff")) // 链接字色
            },
        )
        // [dsh-pet-android] 控制台背景图：全屏 CENTER_CROP、70% 不透明度，内容滚动层叠于其上
        val bg = ImageView(this).apply {
            setImageResource(R.drawable.bg_console)
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = 0.7f
        }
        val content = ScrollView(this).apply { addView(root) }
        setContentView(
            FrameLayout(this).apply {
                addView(bg, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                addView(content, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            },
        )
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
        tickHandler.post(tickRunnable)
        // [dsh-pet-android] 打开应用不再自动拉起桌宠（真机反馈）：
        // 授权返回后由用户手动点「启动桌宠」；开机自启仍由 BootReceiver 负责。
    }

    override fun onPause() {
        super.onPause()
        tickHandler.removeCallbacks(tickRunnable)
    }

    /** 状态翻转落在服务侧异步回调之后，延时补刷一次兜底 */
    private fun refreshSoon() = statusView.postDelayed({ refresh() }, 400)

    /** 重力档位文案（0 = 悬浮模式） */
    private fun gravityText(v: Float): String =
        if (v == 0f) "重力 0×（悬浮）" else "重力 " + v + "×"

    private fun prefs() = getSharedPreferences(PetService.PREFS, MODE_PRIVATE)

    // [dsh-pet-android] 时长实时刷新：前台 1s 节拍；服务在跑读活账本，否则读最近落盘值
    private val tickHandler = Handler(Looper.getMainLooper())
    private var runtimeLabel: TextView? = null
    private val tickRunnable = object : Runnable {
        override fun run() {
            val ms = PetService.activeController?.runtimeTotalMs()
                ?: RuntimeLedgerStore(this@ConsoleActivity).load()
            runtimeLabel?.text = fmtRuntime(ms)
            tickHandler.postDelayed(this, 1_000L)
        }
    }

    private fun fmtRuntime(ms: Double): String {
        if (ms < 60_000.0) return "累计陪伴 <1 分钟"
        val mins = (ms / 60_000.0).toLong()
        val h = mins / 60
        val m = mins % 60
        return when {
            h >= 24 -> "累计陪伴 ${h / 24} 天 ${h % 24} 小时"
            h > 0 -> "累计陪伴 $h 小时 $m 分钟"
            else -> "累计陪伴 $m 分钟"
        }
    }

    private fun refresh() {
        val canDraw = Settings.canDrawOverlays(this)
        statusView.text = when {
            !canDraw -> getString(R.string.status_no_overlay)
            PetService.running -> getString(R.string.status_running)
            else -> getString(R.string.status_stopped)
        }
        guideBlock.visibility = if (canDraw) View.GONE else View.VISIBLE
        controlsBlock.visibility = if (canDraw) View.VISIBLE else View.GONE
        pauseBtn.visibility = if (PetService.running) View.VISIBLE else View.GONE
    }

    /** 直达本应用的系统悬浮窗开关页（ROM 异常时退到应用详情页） */
    private fun openOverlaySettings() {
        val uri = Uri.parse("package:$packageName")
        try {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, uri))
        } catch (e: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri))
            } catch (e2: Exception) {
                Toast.makeText(this, e2.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun requestNotificationsAndStart() {
        // 常驻通知需要 Android 13+ 运行时授权；拒绝也不阻塞启动（仅通知不显示）
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            return
        }
        startPet()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1) startPet()
    }

    private fun startPet() {
        if (!Settings.canDrawOverlays(this)) {
            refresh()
            return
        }
        PetService.requestStart(this) // 乐观翻转：UI 不等异步 onStartCommand
        refresh()
        refreshSoon()
    }

    private fun togglePause() {
        if (!PetService.running) return
        startService(Intent(this, PetService::class.java).setAction(PetService.ACTION_TOGGLE_PAUSE))
    }

    companion object {
        private const val KEY_AUTOSTART = "autostart"
    }
}
