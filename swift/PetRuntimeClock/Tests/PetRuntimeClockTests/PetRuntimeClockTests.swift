import XCTest
@testable import PetRuntimeClock

final class PetRuntimeClockTests: XCTestCase {
    func testPauseStopResumeAccumulates() {
        var l = RuntimeLedger()
        l.resume(now: 100)
        l.pause(now: 160) // 60s
        l.resume(now: 200)
        l.pause(now: 260) // +60s
        XCTAssertEqual(l.totalMs, 120_000, accuracy: 0.001)
    }

    func testPauseAnimationStillCounts() {
        // 暂停动画不影响账本：宿主在窗口存在期不调用 pause 即可
        var l = RuntimeLedger()
        l.resume(now: 0)
        XCTAssertEqual(l.runningTotal(now: 90), 90_000, accuracy: 0.001)
        XCTAssertEqual(l.runningTotal(now: 30), 30_000, accuracy: 0.001) // 时钟回拨防御
    }

    func testIdempotentResumeAndPause() {
        var l = RuntimeLedger()
        l.resume(now: 10)
        l.resume(now: 20) // 幂等：锚点不被覆盖
        l.pause(now: 30)
        l.pause(now: 40) // 幂等：无锚点无操作
        XCTAssertEqual(l.totalMs, 20_000, accuracy: 0.001)
    }

    func testNegativeTotalClamped() {
        let l = RuntimeLedger(totalMs: -5)
        XCTAssertEqual(l.totalMs, 0)
    }
}
