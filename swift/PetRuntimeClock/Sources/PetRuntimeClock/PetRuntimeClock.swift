// PetRuntimeClock — 累计运行时长账本（纯逻辑，Skip 转译到 Kotlin）
//
// 设计约束：
//   * 宿主负责时钟与持久化：本类型只做账本运算（开账/结账/实时总额），不碰 IO、不碰线程
//   * 悬浮窗存在即计时：是否"在运行"由宿主（WindowController 生命周期）决定——
//     菜单"暂停动画"不算停止，只要窗口在就 resume 状态
//   * 账号体系扩展性：本类型对"归属"无感知；scope 维度由宿主存储层决定
//     （设备维度 scope="device"，未来账号维度换 scope 即可，账本逻辑不变）
//
// 时钟约定：now 为单调时钟秒（宿主传 SystemClock.elapsedRealtime()/1000），
// 墙钟会被改时间/时区影响，禁用。

public struct RuntimeLedger: Equatable {
    /// 已结账的累计毫秒
    public private(set) var totalMs: Double
    /// 开账锚点（单调时钟秒）；nil = 未在计时
    private var anchor: Double?

    public init(totalMs: Double = 0) {
        self.totalMs = max(0, totalMs)
        self.anchor = nil
    }

    /// 开账：悬浮窗创建/服务拉起时调用。重复调用幂等。
    public mutating func resume(now: Double) {
        if anchor == nil { anchor = now }
    }

    /// 结账：悬浮窗销毁/周期落盘时调用。未开账时幂等无操作。
    public mutating func pause(now: Double) {
        if let a = anchor {
            totalMs += max(0, now - a) * 1000
            anchor = nil
        }
    }

    /// 实时应计总额（毫秒，含未结账锚点）——UI 展示用
    public func runningTotal(now: Double) -> Double {
        if let a = anchor {
            return totalMs + max(0, now - a) * 1000
        }
        return totalMs
    }

    /// 是否在计时
    public var isRunning: Bool { anchor != nil }
}
