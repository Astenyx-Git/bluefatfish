# dsh-pet → 独立 Android 桌宠 APK · 全局方案（定稿）

> 上游仓库：`D:\pet\dsh-pet`（dsh-pet，DSH 桌宠插件）
> 本工程：`D:\pet\dsh-pet-android`
> 状态：P0 实施中（见文末「实施状态」）

## 〇、决策总账

| # | 决策 | 结论 |
|---|---|---|
| 1 | 移植形态 | **独立 APK**，免上架侧载自用；与 DSH 仅存构建期上游关系，运行期零关联、零网络 |
| 2 | 余额功能 | **整体切除**（含气泡、档位动画、trigger 轮询、字体依赖） |
| 3 | 软糖体字体 | **保留**，唯一消费者 = 宠物菜单（DOM）；APK 本体页用系统全局字体 |
| 4 | 多开 | **删除**，单宠单窗对 |
| 5 | 回到初始位置 | **删除**（拖拽/抛掷边界加手势区 inset 后无场景） |
| 6 | 拖拽手感 | **按下即拖**（5px 阈值，上游原样）；长按 ~400ms = 菜单（震动反馈） |
| 7 | 首启授权 | **自动引导**悬浮窗权限（非弹窗，直达系统开关页，onResume 复查拉起） |
| 8 | APK 本体 | **三态控制台**：首启引导 / 运行状态+设置 / 异常恢复 |
| 9 | 鸿蒙 | HarmonyOS ≤4 随 APK 兼容层白拿；**NEXT 不做**（三方悬浮窗未开放，持续观察） |

## 一、产品定义

一只悬浮在 Android 屏幕上、任何应用之上的手绘风桌宠：动画链永不停止（91 动作）、
按下即拖、甩抛反弹 Q 弹、长按三级菜单点播。约 50 MB 单文件 APK、零网络权限、装完即用。

## 二、总体架构

```
【构建期】dsh-pet 仓库（上游，唯一来源）          【运行期】独立 APK（全离线）
src/shared ──build:desktop-core──▶ 补丁 0001(no-balance) ──▶ assets/shared-core.js
runtime/.../renderer.js ─────────▶ 补丁 0002(android)     ──▶ assets/renderer.js
assets/webm(91) + config + 软糖体 ────────────────────────▶ android_assets/

升级路径：上游重跑构建 → sync-upstream 重打补丁 → 换素材重打包
```

## 三、运行形态：双悬浮窗模型

```
┌─ 视觉窗（WebView，FLAG_NOT_TOUCHABLE）──────────────┐
│  宠物全画布（动画链/物理/菜单全在 renderer.js）        │
│  尺寸 = size×9/16 画布 + 四周 0.12×size 余量          │
└──────────────┬─────────────────────────────────────┘
      ┌────────▼────────┐
      │ 交互窗（原生 View）│ ← 仅覆盖身体命中区（HIT_BOX 240×285 / 640×360）
      └─────────────────┘   窗外触摸天然穿透，无需 Electron 式 forward
```

- 跟随：renderer 逐帧 `setBounds`（CSS px）→ 壳按 density 换算，同步移动两窗；
- 菜单期：`setInteractive(true)` 重解释为「两窗扩到菜单并集矩形」，关闭缩回；
- 桥契约（3 方法定稿）：`setBounds` / `setInteractive` / `shellAction(pause|resume|settings|exit)`
  （`openDshSite` 已删）。

## 四、交互模型（GestureRelayView 手势仲裁）

```
按下 ──┬─ 位移 > touchSlop ──▶ 取消长按计时 → 合成 pointermove（拖拽/甩抛/Q弹）
       └─ 静置 ≥ 系统长按时长 ─▶ 震动 → 合成 contextmenu（开菜单）→ 菜单期合成 MouseEvent
```

- 拖拽边界 = 工作区 − 底部手势条 inset（防「看得见抓不着」）；
- 息屏/Doze → `WebView.onPause()` 暂停，亮屏续播（动画链无状态）。

## 五、菜单树（由本地 config 自动推导，零写死）

| 级 | 内容 |
|---|---|
| L1 根面板 | `动作 ▸`（分支）+ `暂停动画/恢复` + `设置` + `退出` |
| L2 分类面板 | 待机(1) · 转向(1) · 拖拽(1) · 点击回应(5) · 移动(3)★真实行走 · 小动作(18) · 玩耍(27) · 吃什么(12) · 时节(21) · 文字(2)★noMirror |
| L3 动画面板 | 91 个动画（97 减 6 个余额），空分类自动隐藏 |

## 六、APK 本体（三态控制台 Activity）

```
点击图标 ─┬─ ① 首启（无权限）：权限解释页 →「去开启」→ 系统开关页 → 返回自动拉起服务 → 宠物上屏
          ├─ ② 运行中：状态卡 + 大小滑杆(即时生效) + 四角定位 + 暂停/退出 + 自启开关 + 关于
          └─ ③ 异常（服务被杀/权限被关）：红字原因 + 一键恢复
```

关闭页面 ≠ 停宠物；FGS 通知点击也进此页（singleTask）。

## 七、权限清单

| 权限 | 用途 |
|---|---|
| `SYSTEM_ALERT_WINDOW` | 悬浮窗（首启自动引导，授权永久有效） |
| `FOREGROUND_SERVICE` + `specialUse` | 常驻运行 + 常驻通知 |
| `POST_NOTIFICATIONS` | 通知显示（Android 13+） |
| `RECEIVE_BOOT_COMPLETED` | 可选开机自启（默认关） |
| ~~INTERNET~~ | **不声明** —— 全离线是信任卖点 |

## 八、里程碑

| 阶段 | 周期 | 产出/验收 |
|---|---|---|
| P0 骨架 | 3~4 天 | 工程 + FGS + 双窗 + AssetLoader + 首启授权链 + 控制台三态骨架 |
| P1 交互 | 4~5 天 | 手势中继全量：按下即拖、甩抛校准、长按菜单+扩窗、手势区 inset |
| P2 完整化 | 3~4 天 | 暂停/退出/设置项、自启、图标+签名、低配调优、ROM 权限文案 |
| P3 打磨 | 按需 | 位置记忆、动作池裁剪 UI、HarmonyOS ≤4 实测 |

## 九、风险与真机矩阵

| 风险 | 缓解 |
|---|---|
| 低配机 VP9-alpha 软解发热 | size 下调 / 动画池裁剪两个旋钮 |
| 逐帧 updateViewLayout 掉帧 | vsync 节流、只改 x/y |
| 国产 ROM 悬浮窗/自启碎片化 | 引导页逐 ROM 文案 |
| 长按/拖拽竞态误触 | touchSlop 调参（唯一手感变量） |
| **小视口菜单适配（真机实测发现）** | 视口仅 ~153css 高：`62vh` 限高会裁掉根面板第 4 项 → 限高覆盖 + 菜单打开时上报 `menuInset`（窗口底超出工作区=导航栏占用），根/子面板夹取与限高按 inset 收缩、行高收紧，保证 4 项在净空完整放下；「地面上收换菜单空间」方案实测伤宠物位置下限，已废弃 |
| **触屏菜单交互（真机实测发现）** | 桌面 hover 模型在触屏级联误触（子面板在指尖下展开→抬手点中更深项）——改为触屏模型：点按=展开分支、滑动=合成滚动（视觉窗不可触摸，原生滚动不存在）、点叶子=激活 |
| **拖拽增益（真机实测发现）** | 合成事件 screenX 必须是真实全局屏幕 CSS 坐标（语义同 Electron）；用视口坐标+常量偏移冒充会与窗口跟随形成反馈环，固定点恰为 1/2 增益 |
| **OneUI 深色模式染色（真机实测发现）** | WebView 算法暗化把透明底/白面板染暗 → API 33+ 关闭 `isAlgorithmicDarkeningAllowed`；菜单 28px box-shadow 在小屏读作暗色底，已去 |

设备矩阵：原生 Pixel 类 + 重度定制 ROM（小米/OPPO）+ 华为（HarmonyOS ≤4）+ 低端机。

## 十、仓库结构

```
dsh-pet-android/
├── PLAN.md                    # 本文件
├── settings.gradle.kts / build.gradle.kts / gradle.properties
├── app/
│   ├── build.gradle.kts       # minSdk 26 / noCompress webm / 无 INTERNET
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/blue/fat/fish/       # Kotlin 壳（代码包 = 应用包名）
│       │   ├── PetService.kt         # FGS：生命周期、通知
│       │   ├── WindowController.kt   # 双窗创建/跟随/扩缩
│       │   ├── PetWebViewHost.kt     # WebView + AssetLoader 虚拟文件服务
│       │   ├── GestureRelayView.kt   # 交互窗：手势仲裁 + 合成事件注入
│       │   ├── PetBridge.kt          # setBounds / setInteractive / shellAction
│       │   ├── ConsoleActivity.kt    # 三态控制台
│       │   ├── ConfigRepo.kt         # 配置读写（SharedPreferences）
│       │   └── BootReceiver.kt       # 可选开机自启（开关门控）
│       ├── res/               # 图标/主题/字符串（系统字体，无自定义）
│       └── assets/
│           ├── index.html / bridge-shim.js
│           ├── renderer.js / shared-core.js   # 上游 + 补丁（sync-upstream 产物）
│           ├── config.jsonc
│           ├── thumb/main/*.webm (91)
│           └── fonts/上首软糖体.ttf
├── patches/                   # 对上游产物的补丁说明（转换逻辑在脚本内）
└── scripts/sync-upstream.mjs  # 上游构建 → 打补丁 → 同步 assets
```

## 十一、明确不做（负范围）

余额/气泡/通知图标 · 多开 · 任何网络功能 · HarmonyOS NEXT · 系统级 iOS 悬浮 ·
Safari/HEVC 分支 · APK 本体自定义字体。

## 实施状态

- [x] 全局方案定稿（本文件）
- [x] 环境探测：node 24 / JDK 25 / Android SDK（platforms & build-tools）
- [x] shared-core.js 构建（rolldown，产出 `window.PetShared`）
- [x] Android 工程骨架：Gradle(KTS) + Manifest(权限/FGS specialUse/自启门控) + Kotlin 壳
  （`PetService` 常驻通知 / `WindowController` 双窗控制器 / `PetWebViewHost` AssetLoader+MIME 兜底 /
  `PetBridge` 三方法桥 / `GestureRelayView` 手势仲裁 / `ConsoleActivity` 三态控制台 / `BootReceiver`）
- [x] renderer.js / index.html fork（`scripts/sync-upstream.mjs` 逐字锚点变换，11 处全命中）
  ：gestureInset 扣减 · MARGIN_RATIO 0.12 · 根级四项=动作▸(10分类·91动画)+暂停动画/恢复+设置+退出 ·
  events 过滤（仅省略余额档位组） ·
  菜单关闭→setInteractive(false) · shellAction 桥 · togglePause · 软糖体 configUrl 相对路径 ·
  bridge-shim 注入 + viewport
- [x] config + 资产同步：config.jsonc 瘦身（单宠 size 180 / balanceEnabled false，经上游校验器验证）；
  91 webm → `assets/thumb/main/`（剔除 6 余额档位）；软糖体 → `assets/fonts/`；bridge-shim.js
- [x] Gradle 编译验证 ✓ **BUILD SUCCESSFUL**（AGP 8.13.2 / Gradle 9.4.1 / JDK 25，自动补装 Platform 36 + Build-Tools 35）
  产物：`app/build/outputs/apk/debug/app-debug.apk`（debug 签名，51.2 MB ≈ 预估 50MB）
- [x] **真机实测通过**（2025-09-01，SM-S9480/三键导航，T1–T13 全过，详见 TEST.md 实测结果）；
  实测驱动的修复：菜单 62vh 裁切 · 触屏菜单交互模型（点按展开/合成滚动） · 拖拽 screenX 语义（半速→1:1） ·
  松手夹取（throwBounds 同款边界） · 菜单防导航栏遮挡（menuInset 自适应，地面上收方案已废弃） ·
  算法暗化关闭 + 菜单阴影去除 · 控制台打开不自启 + 退出/启动按钮乐观翻转单次刷新 · 控制台背景图

> 注：本机沙箱对运行期落盘的原生二进制有应用控制拦截（rolldown `.node` / Gradle `native-platform.dll`），
> 构建需在完整权限下执行；产物 APK 不受影响。实机部署侧载即可。

### 桥接契约（与上游 preload 的差异）

| 调用 | Electron preload | dsh-pet-android |
| --- | --- | --- |
| `setBounds(x,y,w,h)` | 移动/缩放整窗 | 同义：CSS px → `×density` 摆视觉窗，同步收放交互窗 |
| `setInteractive(bool)` | 开关 `setIgnoreMouseEvents(forward)` | 重解释：true=交互窗扩到整视觉窗（盖住菜单），false=缩回身体命中区 |
| `openDshSite(url)` | 系统浏览器打开 DSH | **删除**（bridge-shim 保留空实现） |
| `shellAction(name)` | — | **新增**：`shell-settings`/`shell-exit`/`toggle-pause` |

### 合成事件注入（`window.__dshPetSynthetic`）

- `pointerdown/move` → 直派 `.pet-hit`（等价 pointer capture：拖拽期指针可离开身体）；
  `pointerup` → 直派 `window`（renderer 监听处）。
- 菜单期：`mouseenter` → `.dsh-pet-menu-item` 本体（不冒泡，展开分支子面板）；
  `tap` = mousedown/mouseup/click（叶子激活；点外 mousedown 冒泡到 document 触发菜单关闭）。
- `screenX/Y = client + 10000` 恒定偏移（renderer 只用增量，初速估算不受影响）。
