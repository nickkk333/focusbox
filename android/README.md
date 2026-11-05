# FocusBox Android 客户端

这是一个轻量的 WebView 客户端。启动时填写服务器地址、用户名和密码，登录后与在浏览器中访问同一地址完全一致，所有任务、备忘、番茄记录、统计和设置都可以正常查看与修改。

## 功能

- 首次启动配置服务器地址、用户名、密码
- 自动处理 HTTP Basic Auth
- 完整的 WebView 体验：任务、番茄钟、备忘、统计、设置
- 支持网页端的 JSON 备份导入 / 导出（使用系统文件选择器）
- 顶部菜单：刷新、服务器设置
- 支持局域网 HTTP 和 HTTPS
- 返回键优先返回网页上一页

## 构建

需要：

- JDK 17
- Android SDK Platform 34
- Android SDK Build Tools 34.0.0
- PowerShell 5.1+

```powershell
$env:ANDROID_SDK_ROOT = "D:\tools\android-sdk"
$env:JAVA_HOME = "D:\tools\jdk17\jdk-17.0.21+9"
powershell -ExecutionPolicy Bypass -File android\build.ps1
```

输出：

```text
android/dist/focusbox-android-<版本>.apk
```

首次构建会生成自签名更新密钥 `android/keystore/focusbox.jks`（store password / key password 均为 `focusbox`）。请保留它，后续升级需要用同一密钥签名；如果删除，已安装的旧版本需要先卸载才能安装新版本。

## 安装与使用

1. 将 APK 传到手机并安装，允许“安装未知来源应用”。
2. 打开 FocusBox，填写：
   - 服务器地址：例如 `http://192.168.1.20:8083`
   - 用户名：飞牛安装向导中填写的用户名
   - 密码：飞牛安装向导中填写的密码
3. 点击“连接并保存”。

服务器地址就是浏览器访问的地址，不需要额外添加 `/api`。如果服务器未启用访问认证，用户名和密码可以留空。

## 说明

- 凭据保存在应用私有 SharedPreferences 中，其他应用无法直接读取。
- 应用允许 HTTP 明文流量，以便访问局域网 NAS。公网访问建议在服务器前配置 HTTPS 反向代理。
- 导入文件使用系统文件选择器；导出文件使用系统“保存到”对话框，不申请存储权限。
- WebView 已启用 JavaScript、DOM Storage 和 Cookie，以支持网页端的完整功能。
