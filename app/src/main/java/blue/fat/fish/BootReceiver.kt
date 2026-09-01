package blue.fat.fish

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings

/** 可选开机自启（设置开关门控，默认关；且需要悬浮窗权限已授予） */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_AUTOSTART, false)) return
        if (!Settings.canDrawOverlays(context)) return
        context.startForegroundService(Intent(context, PetService::class.java))
    }

    companion object {
        const val PREFS = "pet-prefs"
        const val KEY_AUTOSTART = "autostart"
    }
}
