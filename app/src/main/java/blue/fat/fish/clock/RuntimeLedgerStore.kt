package blue.fat.fish.clock

import android.content.Context
import blue.fat.fish.PetService

/**
 * 累计运行时长存储（纯 Kotlin 宿主侧，配合 Swift RuntimeLedger）。
 *
 * 数据绑定策略：当前 scope="device"（绑定设备）；未来账号体系上线时，
 * 换 scope 键（如 "acct:<uid>"）即可按账号记账——账本逻辑与展示层不变，
 * 迁移时把 device 账本值并入账号账本即可。
 *
 * 时钟：单调时钟秒（SystemClock.elapsedRealtime()/1000），不受改时间影响。
 * 落盘：long 以 Double.toRawBits 存储（精度足够：Double 整数部分 2^53 内无损）。
 */
class RuntimeLedgerStore(context: Context) {

    private val sp = context.getSharedPreferences(PetService.PREFS, Context.MODE_PRIVATE)

    private fun key(scope: String) = "runtime_total_ms@$scope"

    fun load(scope: String = SCOPE_DEVICE): Double =
        Double.fromBits(sp.getLong(key(scope), 0L))

    fun save(scope: String, ledger: RuntimeLedger) {
        sp.edit().putLong(key(scope), ledger.totalMs.toRawBits()).apply()
    }

    companion object {
        const val SCOPE_DEVICE = "device"
    }
}
