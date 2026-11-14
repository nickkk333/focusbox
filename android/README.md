# FocusBox Android 客户端

应用界面（HTML / CSS / ES Modules）随 APK 一起安装，不需要从服务器下载，也不需要联网才能打开。首次启动时选择数据放在哪里，之后可以随时从菜单「切换数据源」更改。

## 两种数据源

| 模式 | 数据位置 | 需要什么 | 适用场景 |
| --- | --- | --- | --- |
| 从服务器获取数据 | 飞牛 NAS / 自托管服务端的 SQLite | 服务器地址、用户名、密码 | 多台设备共用、数据集中备份 |
| 本机作为服务器 | 手机 WebView 的 localStorage | 无 | 完全离线、单机使用 |

两种模式共用同一套界面与同一份 `/api/*` 契约，也共用 v2 JSON 备份格式，因此备份文件可以互相导入导出。切换模式**不会**清除另一模式的数据。

服务器模式连接的是只提供数据 API 的 fpk 服务端（不提供网页界面）。桌面浏览器访问的只是服务状态页；要操作数据请使用本客户端。

## 功能

- 首次启动选择数据源；菜单可随时切换
- 服务器模式：填写地址 / 账号 / 密码，用 HTTP Basic 逐请求认证，兼容未启用登录的服务端
- 本机模式：内置纯 JS 数据层复刻全部接口，任务、子任务、时间记录、每日打卡、备忘与标签、番茄记录、统计、徽标、设置、导入导出全部可用
- JSON 备份导入 / 导出使用系统文件选择器与「保存到」对话框，不申请存储权限
- 顶部菜单：刷新、服务器设置（服务器模式）、切换数据源、退出登录（服务器模式）
- 支持局域网 HTTP 与 HTTPS；返回键优先返回上一页

## 实现要点

- `assets/app/` 是 `public/` 的副本，`assets/bridge/` 是原生桥接层与离线 API。
- WebView 加载虚拟源 `https://focusbox.app/`，`shouldInterceptRequest` 从 assets 提供静态资源。用虚拟 HTTPS 源而不是 `file://`，是因为 `file://` 下 ES Modules 会被 CORS 阻止。
- 返回 `index.html` 时动态注入 `window.__FOCUSBOX__`（模式与凭据）和 `native-bridge.js`，后者在前端 `app.js` 之前安装 `fetch` 垫片：
  - 服务器模式把相对 `/api/*` 改写为绝对地址并附加 `Authorization: Basic …`；服务端 API-only 模式提供 CORS 与预检支持。
  - 本机模式把 `/api/*` 分派给 `local-api.js`，数据以 v2 备份快照的形式存在 localStorage。
- 认证状态由桥接层接管（前端始终认为已登录），避免跨站 Cookie 与登录页打断体验；凭据错误时由原生层提示并打开服务器设置。
- 前端的「导出备份」是 `<a download>` 导航而非 fetch，因此桥接层拦截该点击，改为取回 JSON 文本后交给原生保存对话框。
- 前端源码不需要为安卓做任何条件分支。

## 构建

需要 JDK 17、Android SDK Platform 34、Build Tools 34.0.0。本项目可把工具链放在 `.tools/` 下（已加入 `.gitignore`），构建脚本会优先使用：

```text
.tools/jdk/jdk-17.0.13+11/
.tools/android-sdk/
```

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File android\build.ps1
```

Linux / macOS / CI：

```bash
./android/build.sh
```

也可用 `ANDROID_SDK_ROOT` / `JAVA_HOME` 指向系统已安装的 SDK 与 JDK。两个脚本都会用 `aapt2 link -A assets` 把内置前端打进 APK，并检查 `assets/bridge/local-api.js` 是否存在。

输出：

```text
android/dist/focusbox-android-<版本>.apk
android/dist/focusbox-android-<版本>.apk.sha256
```

推送 `v*` tag 时，`.github/workflows/release.yml` 会在 CI 中安装 JDK 17 与 Android SDK，构建并签名 APK，同时构建飞牛 fpk，一起附加到 GitHub Release。

仓库中已包含自签名更新密钥 `android/keystore/focusbox.jks`（store password / key password 均为 `focusbox`）。它仅用于保证后续 APK 可以覆盖安装，不用于保护任何服务器数据。如果删除或更换密钥，已安装的旧版本需要先卸载才能安装新版本。

## 安装与使用

1. 将 APK 传到手机并安装，允许「安装未知来源应用」。
2. 打开 FocusBox，选择数据源：
   - **本机作为服务器** → 直接开始使用，数据只在这台手机。
   - **从服务器获取数据** → 填写 `http://飞牛IP:8083`（端口以安装向导为准）、飞牛安装向导中的用户名和密码，点击「连接」。
3. 服务器模式可从菜单「服务器设置」修改地址或账号；「切换数据源」回到选择页。

服务器地址不需要额外添加 `/api`。如果服务端未启用登录，用户名和密码可以留空。

## 说明与限制

- 凭据保存在应用私有 SharedPreferences 中，其他应用无法直接读取；退出登录会清除用户名与密码并撤销会话 Cookie，但保留服务器地址。
- 本机模式数据存在 WebView 的 localStorage，容量受系统限制（通常数 MB）。**清除应用数据会一并删除**，建议定期用「导出备份」保存到外部文件。
- 本机模式是单机数据源，不与服务器自动同步；需要迁移时用导出 / 导入备份。
- 应用允许 HTTP 明文流量，以便访问局域网 NAS。公网访问建议在服务器前配置 HTTPS 反向代理。
- WebView 已启用 JavaScript、DOM Storage 与 Cookie；未启用文件访问，内置资源通过虚拟源提供。
