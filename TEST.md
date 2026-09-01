# 真机冒烟测试清单（adb 驱动，P0 验收门槛）

前置：手机开启「开发者选项 → USB 调试」（或无线调试），连接后 `adb devices` 出现设备即可开测。
授权直通：`adb shell appops set blue.fat.fish SYSTEM_ALERT_WINDOW allow`（免手动去系统开关页）；
`adb shell pm grant blue.fat.fish android.permission.POST_NOTIFICATIONS`（Android 13+）。

| # | 步骤 | 命令/操作 | 预期 |
| --- | --- | --- | --- |
| T1 | 安装 | `adb install -r app-debug.apk` | 成功，桌面出现「蓝色大肥鱼」 |
| T2 | 授权直通 | appops + pm grant（见上） | 均成功 |
| T3 | 首启链 | `am start -n blue.fat.fish/.ConsoleActivity` | 授权后控制台显示控制项；**打开应用不再自启桌宠**（真机反馈，启动走按钮/开机自启走 BootReceiver） |
| T4 | 双悬浮窗 | `dumpsys window windows` 过滤 dshpet | 两窗：视觉窗（不可触摸）+ 交互窗（身体命中区矩形） |
| T5 | 渲染 | `screencap` 截图 | 宠物显示在右下角、透明背景、无黑底；错误页未出现 |
| T6 | 点击回应 | `input tap` 宠物身体中心 | 播放点击回应动画（截图前后对比） |
| T7 | 按下即拖 | `input swipe` 身体→屏幕中部，时长 800ms | 宠物跟手移动，松手落定（快甩则抛掷滑行） |
| T8 | 长按菜单 | `input swipe` 同点 700ms | 震动 + 根面板：动作▸ / 暂停动画 / 设置 / 退出 |
| T9 | 三级菜单 | 点「动作▸」→ 分类 → 动画叶子 | 子面板逐级展开；叶子点击后播对应动画、菜单收起 |
| T10 | 边界 | 拖到屏幕底部手势区 | 宠物不进导航条区（gestureInset 生效） |
| T11 | 暂停/恢复 | 控制台按钮（经 PetService 转发） | 动画定格 / 续播 |
| T12 | 退出 | 菜单「退出」 | 双窗消失、服务停止、通知撤除 |
| T13 | 稳定性 | logcat 全程过滤 chromium/dshpet/AndroidRuntime | 无 [dsh-pet] 错误、无崩溃堆栈 |

判定：T1–T5 全过 = P0 验收通过；T6–T9 = 交互手感初验；异常逐项记录进 PLAN「风险」节。

## 真机实测结果（2025-09-01，SM-S9480 / 1080×2340 @450dpi / 三键导航）

| # | 结果 | 备注 |
| --- | --- | --- |
| T1 安装 / T2 授权直通 | ✅ | Streamed Install + appops 均通过 |
| T3 首启链 | ✅ | 控制台三态正常；不自启（2025-09-01 按feedback 改） |
| T4 双窗几何 | ✅ | 交互窗=身体命中区（190×225）；视觉窗=setBounds 驱动；手势区侧条避开 |
| T5 渲染 | ✅ | 宠物可见、透明通道完好、无错误页 |
| T6 点击回应 | ✅ | 合成事件全链路，动画切换 |
| T7 拖拽 | ✅（修复后） | 初版半速——shim 用视口坐标冒充 screenX 与窗口跟随形成反馈环（固定点恰 1/2）；改为中继注入真实全局屏幕 CSS 坐标后 1:1 |
| T8 长按菜单 | ✅（修复后） | 初版只见 3 项——MENU_CSS 62vh 在 153css 视口≈95px，动作▸（第 4 项）折入滚动区；限高覆盖后 4 项齐全 |
| T9 三级菜单 | ✅（修复后） | 触屏模型重做：点按=展开分支（转译 mouseenter，绝不 click）、滑动=合成滚动、点外=关闭；桌面 hover 模型在触屏会误触（子面板在指尖下展开后抬手点中更深项） |
| T10 边界 | ✅（修复后） | 松手夹取补齐（throwBounds 同款边界，sprite 坐标系）；菜单防系统栏：menuInset（窗口底超出工作区高度）驱动夹取与限高收缩 |
| T11 暂停/恢复 | ✅ | 菜单项与控制台按钮双通道验证 |
| T12 退出 | ✅（修复后） | 菜单「退出」即时停服撤窗；控制台退出按钮乐观翻转（requestStop）单次刷新 UI，双窗 0 残留 |
| T13 稳定性 | ✅ | 全程无 [dsh-pet] 错误、无崩溃堆栈；menu tree=4 groups=10 探针证实树完整 |

### 实测驱动的附加修复
- 控制台打开应用不再自启桌宠（用户反馈）；启动/退出按钮乐观翻转 + 400ms 兜底补刷
- 控制台背景图（res/drawable/bg_console.jpg，CENTER_CROP）
- 菜单 28px box-shadow 去除：小屏上读作暗色底
