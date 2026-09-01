# 蓝色大肥鱼（bluefatfish）

Android 桌面宠物应用：以双悬浮窗常驻屏幕任意应用之上，可拖拽、抛掷、互动。

基于 GitHub 开源项目 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT）的 Android 独立发行版，无 DSH 运行时依赖。

## 特性

- **双悬浮窗架构**：视觉窗（透明 WebView 渲染 VP9 动画）+ 交互窗（身体命中区手势仲裁）
- **91 个动画**：待机 / 点击回应 / 移动 / 动作（10 分类），含慢放物理与抛掷滑行
- **长按菜单**：动作分类浏览、暂停/恢复、设置、退出；触屏交互模型（点按展开、滑动滚动）
- **真机打磨**：拖拽 1:1 跟手、边界夹取、三键导航/手势条适配、菜单防系统栏遮挡
- **全离线**：不声明 `INTERNET` 权限，素材全部内置
- **可选开机自启**

## 系统要求

- Android 8.0+（API 26）
- 「显示在其他应用上层」权限（应用内引导开启）

## 构建

```bash
./gradlew :app:assembleDebug   # 调试包
./gradlew :app:assembleRelease # 发布包（需自备签名密钥库，仓库不含）
```

签名配置见 `app/build.gradle.kts` 的 `signingConfigs.release`，默认指向项目根目录的 `bluefatfish` 密钥库。

## 协议

本项目以 [Apache-2.0](LICENSE) 协议开源。

上游项目 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 以 MIT 协议发布，动画素材来自该项目。
