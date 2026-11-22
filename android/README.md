# FocusBox Android 客户端

这是一个原生 Android 客户端（Java + Android SDK，非 WebView 套壳），直接调用 FocusBox 的 REST 接口。打开 App 后填写服务器地址、用户名和密码登录，即可在手机上使用今日工作台、任务清单、番茄钟、备忘与统计。

## 功能

- **登录页**：填写服务器地址（如 `http://192.168.1.20:8083`）、用户名、密码；可勾选「记住密码」
- **会话**：登录后保存服务端会话 Cookie，同时兼容 HTTP Basic，退出登录后回到登录页，服务器地址保留
- **今日**：今日专注时长、今日待办、备忘总数概览，快速添加任务，勾选完成，最近备忘预览
- **任务**：进行中 / 已完成 / 全部筛选，关键词搜索，新建任务（项目、优先级、类型、截止日期、预计时长、备注），切换完成、删除
- **任务详情**：与网页端详情一致——状态与创建时间、标题、所属项目、优先级、预计时长、开始/截止日期、备注；每日打卡任务的打卡日历；子任务（新增、勾选、改名、删除）；时间记录（番茄专注/手动时长汇总、手动记录与删除、最近番茄记录）；保存修改与删除任务
- **番茄钟**：专注 / 短休息 / 长休息三种模式，进度环，开始 / 暂停 / 重置 / 结束并记录，可关联今日任务，完成后写入服务端并自动刷新统计，读取服务端的番茄参数与每日目标
- **备忘**：随手记录、搜索、置顶、编辑、删除，自动提取 `#标签`
- **统计**：7 / 30 / 90 天专注趋势柱状图、总专注、日均、番茄数、连续天数、任务完成与新增备忘、项目时间分布
- **退出登录**：顶部「退出」回到登录页，可更换服务器或账号

## 目录结构

```text
android/
├── AndroidManifest.xml
├── build.ps1                 # Windows 本地构建
├── build.sh                  # Linux / macOS / CI 构建
├── keystore/focusbox.jks     # 自签名更新密钥
├── res/                      # 图标、主题与字符串
└── src/com/nickkk333/focusbox/
    ├── MainActivity.java     # 应用外壳、标签导航、登录状态
    ├── LoginScreen.java      # 登录页
    ├── TodayScreen.java      # 今日工作台
    ├── TasksScreen.java      # 任务清单
    ├── PomodoroScreen.java   # 番茄钟
    ├── MemosScreen.java      # 备忘
    ├── StatsScreen.java      # 统计
    ├── TaskRow.java          # 任务列表行
    ├── TaskForm.java         # 新建任务与删除确认
    ├── TaskDetailPage.java   # 任务详情页（字段、子任务、时间记录、打卡日历）
    ├── TimerRing.java        # 番茄钟进度环
    ├── BarChart.java         # 统计柱状图
    ├── ApiClient.java        # REST 客户端（Cookie / Basic）
    ├── SessionStore.java     # 服务器、账号与会话存储
    ├── Async.java            # 后台请求
    ├── BaseScreen.java       # 页面基类
    └── Ui.java               # 代码化 UI 工具
```

## GitHub CI 构建

推送 `v*` tag 时，`.github/workflows/release.yml` 会自动：

1. 安装 JDK 17、Android SDK Platform 34 与 Build Tools 34.0.0
2. 运行 `android/build.sh` 编译并签名 APK
3. 将以下文件附加到 GitHub Release：

```text
focusbox-android-<版本>.apk
focusbox-android-<版本>.apk.sha256
```

无需在本地安装 Android 构建环境。

## 本地构建（可选）

需要：

- JDK 17
- Android SDK Platform 34
- Android SDK Build Tools 34.0.0
- Windows：PowerShell 5.1+
- Linux / macOS：Bash

Windows：

```powershell
$env:ANDROID_SDK_ROOT = "<Android SDK 路径>"
$env:JAVA_HOME = "<JDK 17 路径>"
powershell -ExecutionPolicy Bypass -File android\build.ps1
```

Linux / macOS：

```bash
export ANDROID_SDK_ROOT="<Android SDK 路径>"
export JAVA_HOME="<JDK 17 路径>"
export PATH="$JAVA_HOME/bin:$PATH"
./android/build.sh
```

输出：

```text
android/dist/focusbox-android-<版本>.apk
```

仓库中已包含自签名更新密钥 `android/keystore/focusbox.jks`（store password / key password 均为 `focusbox`）。它仅用于保证后续 APK 可以覆盖安装，不用于保护任何服务器数据。如果删除或更换密钥，已安装的旧版本需要先卸载才能安装新版本。

## 安装与使用

1. 将 APK 传到手机并安装，允许「安装未知来源应用」。
2. 打开 FocusBox，在登录页填写：
   - 服务器地址：例如 `http://192.168.1.20:8083`
   - 用户名 / 密码：飞牛安装向导或 `FOCUSBOX_USERNAME` / `FOCUSBOX_PASSWORD` 中设置的账号
3. 点击「登录」。之后可从顶部「退出」回到登录页，服务器地址会保留，方便更换地址或账号。

服务器地址就是浏览器访问的地址，不需要额外添加 `/api`。如果服务器未启用登录，用户名和密码可以留空。

## 说明

- 只使用 Android 系统自带 API，不依赖 AndroidX、Kotlin 或第三方网络库，构建通过 `aapt2` + `javac` + `d8` 手工完成。
- 凭据保存在应用私有 SharedPreferences 中，其他应用无法直接读取；退出登录会清除会话与（未勾选记住时的）密码，但保留服务器地址。
- 应用允许 HTTP 明文流量，以便访问局域网 NAS；公网访问建议在服务器前配置 HTTPS 反向代理。
- 统计按手机本地时区传入 `tzOffset`，与网页端保持一致。
- 番茄钟在前台页面内计时；切换标签不会中断，退出登录或关闭应用会停止计时。
