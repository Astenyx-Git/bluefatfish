package blue.fat.fish

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.provider.Settings

/**
 * 桌宠前台服务：持有 WindowController（双悬浮窗）。
 * FGS 类型 specialUse（侧载自用，无商店审核诉求）；常驻通知点击回控制台。
 */
class PetService : Service() {
    companion object {
        private const val CHANNEL_ID = "pet"
        private const val NOTIFICATION_ID = 1
        const val ACTION_TOGGLE_PAUSE = "blue.fat.fish.TOGGLE_PAUSE"
        const val ACTION_SET_GRAVITY = "blue.fat.fish.SET_GRAVITY"
        const val ACTION_SET_DRAG = "blue.fat.fish.SET_DRAG"
        const val PREFS = "pet-prefs"
        const val KEY_GRAVITY_MULT = "gravity_mult"
        const val KEY_DRAG_MULT = "drag_mult"
        @Volatile
        var running = false
            private set

        /** 控制台乐观翻转：stopService→onDestroy 异步，UI 若等销毁回执会滞后一轮
         *  （真机实测：退出按钮第一次停宠物、第二次才刷新 UI）。 */
        fun requestStop(context: Context) {
            running = false
            context.stopService(Intent(context, PetService::class.java))
        }

        /** 同理：startForegroundService→onStartCommand 异步，乐观置真让 UI 立即反映 */
        fun requestStart(context: Context) {
            running = true
            context.startForegroundService(Intent(context, PetService::class.java))
        }
    }

    private var controller: WindowController? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "桌宠", NotificationManager.IMPORTANCE_MIN).apply {
                setShowBadge(false)
            },
        )
        val pi = PendingIntent.getActivity(
            this, 0, Intent(this, ConsoleActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_pet)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("宠物正在屏幕上陪伴你")
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Settings.canDrawOverlays(this)) {
            // 无授权起不来（首启链路保证不会走到这里）：显式退出，控制台会引导授权
            stopSelf()
            return START_NOT_STICKY
        }
        if (controller == null) {
            controller = WindowController(this).also { it.start() }
            running = true
        }
        // 控制台的「暂停 / 恢复动画」走同一 renderer 通道（与菜单项同源）
        if (intent?.action == ACTION_TOGGLE_PAUSE) controller?.togglePause()
        // 控制台重力拖动条：实时注入 renderer（window.__dshPetGravityMult）
        if (intent?.action == ACTION_SET_GRAVITY) {
            val gm = intent.getFloatExtra("gm", 1f)
            controller?.evalJs("window.__dshPetGravityMult=" + gm + ";")
        }
        // 控制台阻力拖动条：实时注入 renderer（window.__dshPetDragUserMult，乘算于档位基础阻力）
        if (intent?.action == ACTION_SET_DRAG) {
            val dm = intent.getFloatExtra("dm", 1f)
            controller?.evalJs("window.__dshPetDragUserMult=" + dm + ";")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        controller?.destroy()
        controller = null
        running = false
        super.onDestroy()
    }
}
