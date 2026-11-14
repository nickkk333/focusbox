package com.nickkk333.focusbox;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.text.method.PasswordTransformationMethod;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.HttpAuthHandler;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebViewDatabase;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * FocusBox 安卓客户端。
 *
 * 前端资源随 APK 内置（assets/app），通过虚拟 HTTPS 源加载，
 * 这样 ES Modules 能正常工作，且前端不需要为安卓改动任何代码。
 * 数据源由首次启动选择：
 *   server → 飞牛 fpk / 自托管的 API 服务（assets/bridge/native-bridge.js 注入 Basic 认证）
 *   local  → 内置的纯浏览器离线 API（localStorage 持久化，不发任何网络请求）
 */
public class MainActivity extends Activity {

    private static final String PREFS_NAME = "focusbox";
    private static final String KEY_MODE = "mode";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_PASSWORD = "password";
    private static final String KEY_LOGGED_IN = "logged_in";

    private static final String MODE_SERVER = "server";
    private static final String MODE_LOCAL = "local";

    /** 虚拟源：不发起真实网络请求，全部由 shouldInterceptRequest 从 assets 提供。 */
    private static final String APP_ORIGIN = "https://focusbox.app";
    private static final String APP_URL = APP_ORIGIN + "/";

    private static final int REQUEST_FILE_CHOOSER = 1001;
    private static final int REQUEST_SAVE_EXPORT = 1002;
    private static final int MENU_REFRESH = 1;
    private static final int MENU_SETTINGS = 2;
    private static final int MENU_SWITCH = 3;
    private static final int MENU_LOGOUT = 4;

    // 仅本地调试时改为 true，正式 APK 保持 false。
    private static final boolean WEBVIEW_DEBUG = false;

    private SharedPreferences prefs;
    private String mode = "";
    private String serverUrl = "";
    private String username = "";
    private String password = "";
    private boolean loggedIn = false;

    private WebView webView;
    private ProgressBar progressBar;
    private View errorView;
    private TextView errorText;
    private boolean errorShown = false;
    private boolean webScreen = false;

    private ValueCallback<Uri[]> filePathCallback;
    private String pendingExportUrl;
    private String pendingExportContent;
    private String pendingExportName;
    private AlertDialog settingsDialog;

    private interface ResultCallback {
        void onResult(boolean ok, String message, String cookie);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(WEBVIEW_DEBUG);
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        loadPreferences();

        if (MODE_LOCAL.equals(mode)) {
            showWebScreen();
        } else if (MODE_SERVER.equals(mode) && loggedIn && !serverUrl.isEmpty()) {
            showWebScreen();
        } else if (MODE_SERVER.equals(mode)) {
            showSetupScreen();
        } else {
            showModeScreen();
        }
    }

    private void loadPreferences() {
        mode = prefs.getString(KEY_MODE, "");
        serverUrl = prefs.getString(KEY_SERVER, "");
        username = prefs.getString(KEY_USERNAME, "");
        password = prefs.getString(KEY_PASSWORD, "");
        loggedIn = prefs.getBoolean(KEY_LOGGED_IN, false);
    }

    private void savePreferences() {
        prefs.edit()
                .putString(KEY_MODE, mode)
                .putString(KEY_SERVER, serverUrl)
                .putString(KEY_USERNAME, username)
                .putString(KEY_PASSWORD, password)
                .putBoolean(KEY_LOGGED_IN, loggedIn)
                .apply();
    }

    /* ------------------------------------------------------------------ *
     * 首次启动：选择数据源
     * ------------------------------------------------------------------ */

    private void showModeScreen() {
        destroyWebView();
        webScreen = false;
        setTitle("FocusBox · 选择数据源");
        setContentView(buildModeView());
        invalidateOptionsMenu();
    }

    private View buildModeView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(245, 243, 238));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(34), dp(24), dp(28));
        scroll.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("专注盒子");
        title.setTextSize(30);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.rgb(31, 35, 40));
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("先选择数据放在哪里，之后可以在菜单里随时更换。\n应用界面已随安装包内置，无需联网下载。");
        subtitle.setTextSize(14);
        subtitle.setTextColor(Color.rgb(95, 102, 114));
        subtitle.setLineSpacing(dp(3), 1f);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(8);
        subLp.bottomMargin = dp(28);
        root.addView(subtitle, subLp);

        root.addView(buildModeCard(
                "从服务器获取数据",
                "连接飞牛 NAS 上的「专注盒子」数据服务，任务、备忘与专注记录保存在服务器，可在浏览器与其他设备共用。",
                "填写服务器地址",
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        mode = MODE_SERVER;
                        savePreferences();
                        showSetupScreen();
                    }
                }), cardParams(0));

        root.addView(buildModeCard(
                "本机作为服务器",
                "数据只保存在这台手机，完全离线可用，不需要 NAS 或账号。后续可从菜单切换到服务器模式。",
                "开始使用本机数据",
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        mode = MODE_LOCAL;
                        loggedIn = true;
                        savePreferences();
                        showWebScreen();
                    }
                }), cardParams(dp(16)));

        TextView note = new TextView(this);
        note.setText("当前版本 v1.1.0 · 两种模式共用同一套界面与数据格式，备份文件可以互相导入。");
        note.setTextSize(12);
        note.setTextColor(Color.rgb(138, 145, 156));
        LinearLayout.LayoutParams noteLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        noteLp.topMargin = dp(24);
        root.addView(note, noteLp);

        return scroll;
    }

    private LinearLayout.LayoutParams cardParams(int topMargin) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = topMargin;
        return lp;
    }

    private View buildModeCard(String heading, String description, String action,
                               View.OnClickListener listener) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(20), dp(20), dp(18));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(1), Color.rgb(229, 225, 216));
        card.setBackground(bg);

        TextView h = new TextView(this);
        h.setText(heading);
        h.setTextSize(18);
        h.setTypeface(Typeface.DEFAULT_BOLD);
        h.setTextColor(Color.rgb(31, 35, 40));
        card.addView(h);

        TextView d = new TextView(this);
        d.setText(description);
        d.setTextSize(13);
        d.setTextColor(Color.rgb(95, 102, 114));
        d.setLineSpacing(dp(3), 1f);
        LinearLayout.LayoutParams dLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        dLp.topMargin = dp(10);
        card.addView(d, dLp);

        Button button = new Button(this);
        button.setText(action);
        button.setTextSize(15);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        GradientDrawable buttonBg = new GradientDrawable();
        buttonBg.setColor(Color.rgb(232, 85, 63));
        buttonBg.setCornerRadius(dp(10));
        button.setBackground(buttonBg);
        button.setOnClickListener(listener);
        LinearLayout.LayoutParams bLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(46));
        bLp.topMargin = dp(18);
        card.addView(button, bLp);

        return card;
    }

    /* ------------------------------------------------------------------ *
     * 服务器模式：地址与凭据
     * ------------------------------------------------------------------ */

    private String normalizeUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) return "";
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    private void showSetupScreen() {
        destroyWebView();
        webScreen = false;
        setTitle("连接服务器 · FocusBox");
        setContentView(buildSetupView());
        invalidateOptionsMenu();
    }

    private View buildSetupView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(245, 243, 238));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(28));
        scroll.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("连接数据服务");
        title.setTextSize(26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.rgb(31, 35, 40));
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("专注盒子 · 安卓客户端");
        subtitle.setTextSize(14);
        subtitle.setTextColor(Color.rgb(95, 102, 114));
        LinearLayout.LayoutParams subtitleLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        subtitleLp.topMargin = dp(4);
        root.addView(subtitle, subtitleLp);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(8), dp(20), dp(20));
        GradientDrawable cardBackground = new GradientDrawable();
        cardBackground.setColor(Color.WHITE);
        cardBackground.setCornerRadius(dp(16));
        card.setBackground(cardBackground);
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        cardLp.topMargin = dp(24);
        root.addView(card, cardLp);

        final EditText urlInput = createInput(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI,
                "http://192.168.1.20:8083");
        urlInput.setText(serverUrl);
        addField(card, "服务器 IP / 地址", urlInput);

        final EditText userInput = createInput(InputType.TYPE_CLASS_TEXT, "用户名");
        userInput.setText(username);
        addField(card, "用户名", userInput);

        final EditText passInput = createInput(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD,
                "密码");
        passInput.setText(password);
        addField(card, "密码", passInput);

        final TextView formError = new TextView(this);
        formError.setTextSize(13);
        formError.setTextColor(Color.rgb(207, 74, 74));
        formError.setVisibility(View.GONE);
        LinearLayout.LayoutParams errorLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        errorLp.topMargin = dp(12);
        card.addView(formError, errorLp);

        final Button connectButton = new Button(this);
        connectButton.setText("连接");
        connectButton.setTextSize(16);
        connectButton.setTextColor(Color.WHITE);
        connectButton.setAllCaps(false);
        GradientDrawable buttonBackground = new GradientDrawable();
        buttonBackground.setColor(Color.rgb(232, 85, 63));
        buttonBackground.setCornerRadius(dp(10));
        connectButton.setBackground(buttonBackground);
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48));
        buttonLp.topMargin = dp(16);
        card.addView(connectButton, buttonLp);

        Button back = new Button(this);
        back.setText("返回选择数据源");
        back.setAllCaps(false);
        back.setTextColor(Color.rgb(95, 102, 114));
        back.setBackgroundColor(Color.TRANSPARENT);
        back.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showModeScreen();
            }
        });
        card.addView(back, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView note = new TextView(this);
        note.setText("填写飞牛安装向导中的服务器地址、用户名和密码。\n"
                + "如果服务端未启用登录，用户名和密码可以留空。\n"
                + "凭据仅保存在本机；公网访问请使用 HTTPS。");
        note.setTextSize(12);
        note.setTextColor(Color.rgb(95, 102, 114));
        note.setLineSpacing(dp(3), 1f);
        LinearLayout.LayoutParams noteLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        noteLp.topMargin = dp(14);
        root.addView(note, noteLp);

        connectButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final String url = normalizeUrl(urlInput.getText().toString());
                final String user = userInput.getText().toString().trim();
                final String pass = passInput.getText().toString();
                if (url.isEmpty()) {
                    showFormError(formError, "请输入服务器地址。");
                    return;
                }
                try {
                    new URL(url);
                } catch (Exception e) {
                    showFormError(formError, "服务器地址格式不正确。");
                    return;
                }
                hideKeyboard(v);
                formError.setVisibility(View.GONE);
                connectButton.setEnabled(false);
                connectButton.setText("连接中…");
                testConnection(url, user, pass, new ResultCallback() {
                    @Override
                    public void onResult(final boolean ok, final String message, final String cookie) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                if (isFinishing() || isDestroyed()) return;
                                connectButton.setEnabled(true);
                                connectButton.setText("连接");
                                if (!ok) {
                                    showFormError(formError, message);
                                    return;
                                }
                                serverUrl = url;
                                username = user;
                                password = pass;
                                mode = MODE_SERVER;
                                loggedIn = true;
                                savePreferences();
                                applySessionCookie(url, cookie);
                                showWebScreen();
                            }
                        });
                    }
                });
            }
        });

        return scroll;
    }

    /* ------------------------------------------------------------------ *
     * WebView：内置前端 + 资源拦截
     * ------------------------------------------------------------------ */

    private void showWebScreen() {
        destroyWebView();
        webScreen = true;
        setTitle("FocusBox");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        configureWebView();
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setIndeterminate(false);
        progressBar.setVisibility(View.GONE);
        root.addView(progressBar, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(3),
                Gravity.TOP));

        errorView = buildErrorView();
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        errorView.setVisibility(View.GONE);

        setContentView(root);
        invalidateOptionsMenu();
        webView.loadUrl(APP_URL);
    }

    private void destroyWebView() {
        if (webView == null) return;
        webView.stopLoading();
        webView.loadUrl("about:blank");
        webView.setWebViewClient(null);
        webView.setWebChromeClient(null);
        webView.destroy();
        webView = null;
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        // 首页由 assets 动态生成，配置变更后必须拿到新版本
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " FocusBoxAndroid/1.1.0");

        webView.setBackgroundColor(Color.WHITE);
        webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        webView.addJavascriptInterface(new NativeBridge(), "FocusBoxNative");

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveLocalAsset(request);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                errorShown = false;
                hideError();
                if (progressBar != null) {
                    progressBar.setProgress(0);
                    progressBar.setVisibility(View.VISIBLE);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (progressBar != null) progressBar.setVisibility(View.GONE);
                if (!errorShown) hideError();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse errorResponse) {
                Log.w("FocusBoxAndroid", "asset http error "
                        + errorResponse.getStatusCode() + " " + request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    if (progressBar != null) progressBar.setVisibility(View.GONE);
                    showError("界面加载失败，请重启应用。\n"
                            + (error == null ? "" : String.valueOf(error.getDescription())));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (APP_ORIGIN.equalsIgnoreCase(scheme + "://" + uri.getHost())) {
                    return false;
                }
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    // 服务端 API 由桥接层改写为绝对地址，不走这里；其余外链交给浏览器
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {
                    }
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (progressBar != null) {
                    progressBar.setProgress(newProgress);
                    progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             WebChromeClient.FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this,
                            "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                                        String contentDisposition, String mimeType,
                                        long contentLength) {
                if (url == null || url.startsWith("blob:")) {
                    Toast.makeText(MainActivity.this,
                            "暂不支持此下载方式", Toast.LENGTH_SHORT).show();
                    return;
                }
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                if (TextUtils.isEmpty(fileName)) fileName = "focusbox-export.json";
                pendingExportUrl = url;
                pendingExportContent = null;
                pendingExportName = fileName;
                openSaveDialog(fileName,
                        !TextUtils.isEmpty(mimeType) ? mimeType : "application/json");
            }
        });
    }

    /** 把虚拟 origin 的请求映射到 APK 内置资源。 */
    private WebResourceResponse serveLocalAsset(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (uri == null) return null;
        String origin = uri.getScheme() + "://" + uri.getHost();
        if (!APP_ORIGIN.equalsIgnoreCase(origin)) return null;

        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";

        // 漏网的相对 /api 请求：明确报错，不要发到不存在的域名
        if (path.equals("/api") || path.startsWith("/api/")) {
            return jsonAssetResponse(502, "{ \"error\": \"桥接层未接管该请求\" }");
        }

        String assetPath;
        if (path.startsWith("/bridge/")) {
            assetPath = "bridge/" + path.substring("/bridge/".length());
        } else if (path.equals("/favicon.svg")) {
            assetPath = "app/favicon.svg";
        } else {
            assetPath = "app" + path;
        }

        try {
            if (path.equals("/index.html")) {
                String html = injectBridge(readAssetText(assetPath));
                return assetResponse(200, "OK", "text/html", html);
            }
            InputStream stream = getAssets().open(assetPath);
            return assetResponse(200, "OK", mimeFor(assetPath), null, stream);
        } catch (Exception e) {
            Log.w("FocusBoxAndroid", "asset missing: " + assetPath);
            return jsonAssetResponse(404, "{ \"error\": \"资源不存在\" }");
        }
    }

    private String injectBridge(String html) {
        String config;
        try {
            JSONObject o = new JSONObject();
            o.put("mode", mode);
            o.put("serverUrl", serverUrl);
            o.put("username", username);
            o.put("password", password);
            // 防止密码中的 </script> 提前闭合脚本标签
            config = o.toString().replace("</", "<\\/");
        } catch (JSONException e) {
            config = "{}";
        }
        String injection = "<script>window.__FOCUSBOX__=" + config + ";</script>\n"
                + "<script src=\"/bridge/native-bridge.js\"></script>\n</head>";
        return html.replace("</head>", injection);
    }

    private String readAssetText(String assetPath) throws Exception {
        InputStream in = getAssets().open(assetPath);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    private WebResourceResponse assetResponse(int code, String reason, String mime, String text) {
        return assetResponse(code, reason, mime, text, null);
    }

    private WebResourceResponse assetResponse(int code, String reason, String mime,
                                              String text, InputStream stream) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", "*");
        if (mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json")) {
            // 文本资源统一 UTF-8，避免中文注释与文案乱码
        }
        byte[] bytes = text == null ? null : text.getBytes(StandardCharsets.UTF_8);
        InputStream body = stream != null ? stream
                : new ByteArrayInputStream(bytes == null ? new byte[0] : bytes);
        return new WebResourceResponse(mime, "UTF-8", code, reason, headers, body);
    }

    private WebResourceResponse jsonAssetResponse(int code, String json) {
        return assetResponse(code, code == 404 ? "Not Found" : "Error",
                "application/json", json);
    }

    private String mimeFor(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    /* ------------------------------------------------------------------ *
     * 原生 ↔ 前端桥接
     * ------------------------------------------------------------------ */

    private class NativeBridge {
        @JavascriptInterface
        public void onUnauthorized() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this,
                            "服务器拒绝了登录凭据，请检查用户名和密码",
                            Toast.LENGTH_LONG).show();
                    if (webView != null && MODE_SERVER.equals(mode)) showSettingsDialog();
                }
            });
        }

        @JavascriptInterface
        public void onLogout() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    logoutToSetup();
                }
            });
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                }
            });
        }

        /** 前端导出备份：把 JSON 文本交给系统「保存到」对话框。 */
        @JavascriptInterface
        public void saveText(final String payload) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        JSONObject o = new JSONObject(payload);
                        pendingExportContent = o.optString("content", "");
                        pendingExportName = o.optString("filename", "focusbox-backup.json");
                        pendingExportUrl = null;
                        openSaveDialog(pendingExportName, "application/json");
                    } catch (JSONException e) {
                        Toast.makeText(MainActivity.this,
                                "导出数据格式异常", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }
    }

    private void openSaveDialog(String fileName, String mimeType) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(TextUtils.isEmpty(mimeType) ? "application/json" : mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        try {
            startActivityForResult(intent, REQUEST_SAVE_EXPORT);
        } catch (ActivityNotFoundException e) {
            pendingExportUrl = null;
            pendingExportContent = null;
            Toast.makeText(this, "无法打开保存对话框", Toast.LENGTH_SHORT).show();
        }
    }

    /* ------------------------------------------------------------------ *
     * 错误页、设置对话框、连接测试
     * ------------------------------------------------------------------ */

    private View buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.WHITE);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));

        TextView title = new TextView(this);
        title.setText("加载失败");
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.rgb(31, 35, 40));
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        errorText = new TextView(this);
        errorText.setTextSize(14);
        errorText.setTextColor(Color.rgb(95, 102, 114));
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(12), 0, dp(24));
        box.addView(errorText, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        Button retry = new Button(this);
        retry.setText("重试");
        retry.setAllCaps(false);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (webView == null) return;
                errorShown = false;
                hideError();
                webView.loadUrl(APP_URL);
            }
        });
        box.addView(retry);

        Button mode = new Button(this);
        mode.setText("切换数据源");
        mode.setAllCaps(false);
        LinearLayout.LayoutParams modeLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        modeLp.topMargin = dp(8);
        mode.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showModeScreen();
            }
        });
        box.addView(mode, modeLp);

        return box;
    }

    private void showSettingsDialog() {
        if (webView == null) return;

        ScrollView scroll = new ScrollView(this);
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(24), dp(8), dp(24), dp(8));
        scroll.addView(form, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        final EditText urlInput = createInput(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI,
                "http://192.168.1.20:8083");
        urlInput.setText(serverUrl);
        addField(form, "服务器 IP / 地址", urlInput);

        final EditText userInput = createInput(InputType.TYPE_CLASS_TEXT, "用户名");
        userInput.setText(username);
        addField(form, "用户名", userInput);

        final EditText passInput = createInput(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD,
                "密码");
        passInput.setText(password);
        addField(form, "密码", passInput);

        final TextView formError = new TextView(this);
        formError.setTextSize(13);
        formError.setTextColor(Color.rgb(207, 74, 74));
        formError.setVisibility(View.GONE);
        LinearLayout.LayoutParams errorLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        errorLp.topMargin = dp(12);
        form.addView(formError, errorLp);

        final AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("服务器与账号")
                .setView(scroll)
                .setNegativeButton("取消", null)
                .setPositiveButton("保存并连接", null)
                .create();
        settingsDialog = dialog;

        dialog.setOnShowListener(new android.content.DialogInterface.OnShowListener() {
            @Override
            public void onShow(android.content.DialogInterface d) {
                final Button saveButton = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
                saveButton.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        final String url = normalizeUrl(urlInput.getText().toString());
                        final String user = userInput.getText().toString().trim();
                        final String pass = passInput.getText().toString();
                        if (url.isEmpty()) {
                            showFormError(formError, "请输入服务器地址。");
                            return;
                        }
                        try {
                            new URL(url);
                        } catch (Exception e) {
                            showFormError(formError, "服务器地址格式不正确。");
                            return;
                        }
                        hideKeyboard(v);
                        formError.setVisibility(View.GONE);
                        saveButton.setEnabled(false);
                        saveButton.setText("连接中…");
                        testConnection(url, user, pass, new ResultCallback() {
                            @Override
                            public void onResult(final boolean ok, final String message,
                                                 final String cookie) {
                                runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        if (isFinishing() || isDestroyed() || !dialog.isShowing()) return;
                                        saveButton.setEnabled(true);
                                        saveButton.setText("保存并连接");
                                        if (!ok) {
                                            showFormError(formError, message);
                                            return;
                                        }
                                        serverUrl = url;
                                        username = user;
                                        password = pass;
                                        mode = MODE_SERVER;
                                        loggedIn = true;
                                        savePreferences();
                                        applySessionCookie(url, cookie);
                                        clearHttpAuth();
                                        dialog.dismiss();
                                        errorShown = false;
                                        hideError();
                                        // 重新注入桥接配置
                                        webView.loadUrl(APP_URL);
                                        Toast.makeText(MainActivity.this,
                                                "已保存", Toast.LENGTH_SHORT).show();
                                        invalidateOptionsMenu();
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });

        dialog.show();
    }

    private void testConnection(final String baseUrl, final String user,
                                final String pass, final ResultCallback callback) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                try {
                    URL url = new URL(baseUrl + "/api/health");
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(8000);
                    connection.setReadTimeout(12000);
                    connection.setInstanceFollowRedirects(true);
                    connection.setRequestMethod("GET");
                    connection.setRequestProperty("Accept", "application/json");
                    if (!TextUtils.isEmpty(user) || !TextUtils.isEmpty(pass)) {
                        String token = Base64.encodeToString(
                                (user + ":" + pass).getBytes(StandardCharsets.UTF_8),
                                Base64.NO_WRAP);
                        connection.setRequestProperty("Authorization", "Basic " + token);
                    }
                    int code = connection.getResponseCode();
                    if (code >= 200 && code < 300) {
                        // 服务端未启用认证时 health 是匿名接口；有认证时凭据正确才会到这里
                        callback.onResult(true, "", connection.getHeaderField("Set-Cookie"));
                    } else if (code == 401) {
                        callback.onResult(false, "用户名或密码错误。", null);
                    } else if (code == 403) {
                        callback.onResult(false, "服务器拒绝访问（403）。", null);
                    } else if (code == 404) {
                        callback.onResult(false, "服务器可达，但未找到数据接口，请确认服务端版本。", null);
                    } else {
                        callback.onResult(false, "服务器返回 HTTP " + code + "。", null);
                    }
                } catch (Exception e) {
                    String message = e.getMessage();
                    if (message == null || message.trim().isEmpty()) {
                        message = e.getClass().getSimpleName();
                    }
                    String hint = "";
                    if (e instanceof javax.net.ssl.SSLException) {
                        hint = "\n如果是自签名 HTTPS 证书，请改用 http 或为服务器配置有效证书。";
                    }
                    callback.onResult(false, "无法连接服务器：" + message + hint, null);
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }
        }).start();
    }

    private void applySessionCookie(String baseUrl, String cookie) {
        if (TextUtils.isEmpty(cookie)) return;
        String pair = cookie.split(";", 2)[0];
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setCookie(baseUrl + "/", pair);
        cookieManager.flush();
    }

    private void clearHttpAuth() {
        try {
            WebViewDatabase.getInstance(this).clearHttpAuthUsernamePassword();
        } catch (Exception ignored) {
        }
    }

    private void logoutToSetup() {
        final String url = serverUrl;
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(url + "/api/auth/logout").openConnection();
                    connection.setConnectTimeout(5000);
                    connection.setReadTimeout(5000);
                    connection.setRequestMethod("POST");
                    connection.getResponseCode();
                } catch (Exception ignored) {
                } finally {
                    if (connection != null) connection.disconnect();
                }
            }
        }).start();

        username = "";
        password = "";
        loggedIn = false;
        savePreferences();
        CookieManager.getInstance().removeAllCookies(null);
        CookieManager.getInstance().flush();
        clearHttpAuth();
        if (settingsDialog != null && settingsDialog.isShowing()) settingsDialog.dismiss();
        showModeScreen();
        Toast.makeText(this, "已退出，可重新选择数据源", Toast.LENGTH_SHORT).show();
    }

    /* ------------------------------------------------------------------ *
     * 通用控件与生命周期
     * ------------------------------------------------------------------ */

    private EditText createInput(int inputType, String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setInputType(inputType);
        if ((inputType & InputType.TYPE_MASK_VARIATION)
                == InputType.TYPE_TEXT_VARIATION_PASSWORD) {
            input.setTransformationMethod(PasswordTransformationMethod.getInstance());
        }
        input.setTextSize(16);
        input.setTextColor(Color.rgb(31, 35, 40));
        input.setHintTextColor(Color.rgb(138, 145, 156));
        return input;
    }

    private void addField(LinearLayout parent, String label, EditText input) {
        TextView labelView = new TextView(this);
        labelView.setText(label);
        labelView.setTextSize(13);
        labelView.setTypeface(Typeface.DEFAULT_BOLD);
        labelView.setTextColor(Color.rgb(55, 65, 81));
        LinearLayout.LayoutParams labelLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        labelLp.topMargin = dp(14);
        parent.addView(labelView, labelLp);
        parent.addView(input, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private void showFormError(TextView view, String message) {
        view.setText(message);
        view.setVisibility(View.VISIBLE);
    }

    private void hideKeyboard(View view) {
        if (view == null) return;
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(view.getWindowToken(), 0);
    }

    private void showError(String message) {
        errorShown = true;
        if (errorView == null || errorText == null) return;
        errorText.setText(message);
        errorView.setVisibility(View.VISIBLE);
        errorView.bringToFront();
    }

    private void hideError() {
        if (errorView != null) errorView.setVisibility(View.GONE);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(Menu.NONE, MENU_REFRESH, 0, "刷新")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        menu.add(Menu.NONE, MENU_SETTINGS, 1, "服务器设置")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        menu.add(Menu.NONE, MENU_SWITCH, 2, "切换数据源")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        menu.add(Menu.NONE, MENU_LOGOUT, 3, "退出登录")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        return true;
    }

    @Override
    public boolean onPrepareOptionsMenu(Menu menu) {
        MenuItem refresh = menu.findItem(MENU_REFRESH);
        MenuItem settings = menu.findItem(MENU_SETTINGS);
        MenuItem switchMode = menu.findItem(MENU_SWITCH);
        MenuItem logout = menu.findItem(MENU_LOGOUT);
        boolean serverMode = MODE_SERVER.equals(mode);
        if (refresh != null) refresh.setVisible(webScreen);
        if (settings != null) settings.setVisible(webScreen && serverMode);
        if (switchMode != null) switchMode.setVisible(webScreen);
        if (logout != null) logout.setVisible(webScreen && serverMode);
        return super.onPrepareOptionsMenu(menu);
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case MENU_REFRESH:
                if (webView != null) webView.loadUrl(APP_URL);
                return true;
            case MENU_SETTINGS:
                showSettingsDialog();
                return true;
            case MENU_SWITCH:
                showModeScreen();
                return true;
            case MENU_LOGOUT:
                logoutToSetup();
                return true;
            default:
                return super.onOptionsItemSelected(item);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    List<Uri> uris = new ArrayList<>();
                    for (int i = 0; i < count; i++) {
                        uris.add(data.getClipData().getItemAt(i).getUri());
                    }
                    results = uris.toArray(new Uri[0]);
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }

        if (requestCode == REQUEST_SAVE_EXPORT) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri target = data.getData();
                if (pendingExportContent != null) {
                    writeExport(target, pendingExportContent);
                } else if (pendingExportUrl != null) {
                    downloadExport(target, pendingExportUrl);
                }
            }
            pendingExportUrl = null;
            pendingExportContent = null;
        }
    }

    /** 桥接层导出的 JSON 文本直接写入用户选择的文件。 */
    private void writeExport(final Uri target, final String content) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean ok = false;
                OutputStream output = null;
                try {
                    output = getContentResolver().openOutputStream(target, "w");
                    if (output == null) throw new IllegalStateException("无法打开目标文件");
                    output.write(content.getBytes(StandardCharsets.UTF_8));
                    output.flush();
                    ok = true;
                } catch (Exception e) {
                    Log.w("FocusBoxAndroid", "write export failed", e);
                } finally {
                    if (output != null) {
                        try { output.close(); } catch (Exception ignored) { }
                    }
                }
                final boolean success = ok;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this,
                                success ? "已导出到所选位置" : "导出失败",
                                Toast.LENGTH_SHORT).show();
                    }
                });
            }
        }).start();
    }

    /** 兼容 WebView 直接触发的下载（例如服务端模式的绝对地址导出）。 */
    private void downloadExport(final Uri target, final String url) {
        Toast.makeText(this, "正在导出…", Toast.LENGTH_SHORT).show();
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                InputStream input = null;
                OutputStream output = null;
                boolean success = false;
                String message = "导出失败";
                try {
                    connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setConnectTimeout(8000);
                    connection.setReadTimeout(30000);
                    connection.setRequestMethod("GET");
                    if (!TextUtils.isEmpty(username) || !TextUtils.isEmpty(password)) {
                        String token = Base64.encodeToString(
                                (username + ":" + password).getBytes(StandardCharsets.UTF_8),
                                Base64.NO_WRAP);
                        connection.setRequestProperty("Authorization", "Basic " + token);
                    }
                    int code = connection.getResponseCode();
                    if (code < 200 || code >= 300) {
                        message = "导出失败：HTTP " + code;
                    } else {
                        input = connection.getInputStream();
                        output = getContentResolver().openOutputStream(target, "w");
                        if (output == null) throw new IllegalStateException("无法打开目标文件");
                        byte[] buffer = new byte[8192];
                        int read;
                        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                        output.flush();
                        success = true;
                        message = "已导出到所选位置";
                    }
                } catch (Exception e) {
                    message = "导出失败：" + e.getMessage();
                } finally {
                    try { if (input != null) input.close(); } catch (Exception ignored) { }
                    try { if (output != null) output.close(); } catch (Exception ignored) { }
                    if (connection != null) connection.disconnect();
                }
                final String finalMessage = message;
                final boolean finalSuccess = success;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing() || isDestroyed()) return;
                        Toast.makeText(MainActivity.this, finalMessage,
                                finalSuccess ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG).show();
                    }
                });
            }
        }).start();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (settingsDialog != null && settingsDialog.isShowing()) settingsDialog.dismiss();
        destroyWebView();
        super.onDestroy();
    }
}
