package com.nickkk333.focusbox;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
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

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final String PREFS_NAME = "focusbox";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_PASSWORD = "password";
    private static final String KEY_LOGGED_IN = "logged_in";

    private static final int REQUEST_FILE_CHOOSER = 1001;
    private static final int REQUEST_SAVE_EXPORT = 1002;
    private static final int MENU_REFRESH = 1;
    private static final int MENU_SETTINGS = 2;
    private static final int MENU_LOGOUT = 3;

    // 仅本地调试时改为 true，正式 APK 保持 false。
    private static final boolean WEBVIEW_DEBUG = false;

    private SharedPreferences prefs;
    private String serverUrl = "";
    private String username = "";
    private String password = "";
    private boolean loggedIn = false;

    private WebView webView;
    private ProgressBar progressBar;
    private View errorView;
    private TextView errorText;
    private boolean errorShown = false;
    private boolean setupScreen = false;

    private ValueCallback<Uri[]> filePathCallback;
    private String pendingExportUrl;
    private AlertDialog settingsDialog;

    private interface ResultCallback {
        void onResult(boolean ok, String message, String cookie);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (WEBVIEW_DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        } else {
            WebView.setWebContentsDebuggingEnabled(false);
        }
        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        loadPreferences();
        if (serverUrl.isEmpty() || !loggedIn) {
            showSetupScreen();
        } else {
            showWebScreen();
        }
    }

    private void loadPreferences() {
        serverUrl = prefs.getString(KEY_SERVER, "");
        username = prefs.getString(KEY_USERNAME, "");
        password = prefs.getString(KEY_PASSWORD, "");
        loggedIn = prefs.getBoolean(KEY_LOGGED_IN, false);
    }

    private void savePreferences() {
        prefs.edit()
                .putString(KEY_SERVER, serverUrl)
                .putString(KEY_USERNAME, username)
                .putString(KEY_PASSWORD, password)
                .putBoolean(KEY_LOGGED_IN, loggedIn)
                .apply();
    }

    private String normalizeUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            return "";
        }
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    private String normalizeHost(String host) {
        if (host == null) {
            return "";
        }
        if (host.startsWith("[") && host.endsWith("]")) {
            return host.substring(1, host.length() - 1);
        }
        return host;
    }

    private void showSetupScreen() {
        WebView oldWebView = webView;
        webView = null;
        setupScreen = true;
        setTitle("登录 · FocusBox");
        setContentView(buildSetupView());
        if (oldWebView != null) {
            oldWebView.stopLoading();
            oldWebView.setWebViewClient(null);
            oldWebView.destroy();
        }
        invalidateOptionsMenu();
    }

    private View buildSetupView() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(245, 247, 250));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(28));
        scroll.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("FocusBox");
        title.setTextSize(30);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.rgb(17, 24, 39));
        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView subtitle = new TextView(this);
        subtitle.setText("专注盒子 · 安卓客户端");
        subtitle.setTextSize(14);
        subtitle.setTextColor(Color.rgb(107, 114, 128));
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
        card.setElevation(dp(2));
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

        final EditText userInput = createInput(
                InputType.TYPE_CLASS_TEXT,
                "用户名");
        userInput.setText(username);
        addField(card, "用户名", userInput);

        final EditText passInput = createInput(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD,
                "密码");
        passInput.setText(password);
        addField(card, "密码", passInput);

        final TextView formError = new TextView(this);
        formError.setTextSize(13);
        formError.setTextColor(Color.rgb(220, 38, 38));
        formError.setVisibility(View.GONE);
        LinearLayout.LayoutParams errorLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        errorLp.topMargin = dp(12);
        card.addView(formError, errorLp);

        final Button connectButton = new Button(this);
        connectButton.setText("登录");
        connectButton.setTextSize(16);
        connectButton.setTextColor(Color.WHITE);
        connectButton.setAllCaps(false);
        GradientDrawable buttonBackground = new GradientDrawable();
        buttonBackground.setColor(Color.rgb(79, 70, 229));
        buttonBackground.setCornerRadius(dp(12));
        connectButton.setBackground(buttonBackground);
        LinearLayout.LayoutParams buttonLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(48));
        buttonLp.topMargin = dp(16);
        card.addView(connectButton, buttonLp);

        TextView note = new TextView(this);
        note.setText("填写服务器 IP / 地址（例如 http://192.168.1.20:8083）、用户名和密码后登录。\n"
                + "退出登录后可在这里更换服务器或账号。\n"
                + "如果服务器未启用登录，用户名和密码可以留空。\n"
                + "凭据仅保存在本机；公网访问请使用 HTTPS。");
        note.setTextSize(12);
        note.setTextColor(Color.rgb(107, 114, 128));
        note.setLineSpacing(dp(3), 1f);
        LinearLayout.LayoutParams noteLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        noteLp.topMargin = dp(14);
        card.addView(note, noteLp);

        connectButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String url = normalizeUrl(urlInput.getText().toString());
                String user = userInput.getText().toString().trim();
                String pass = passInput.getText().toString();
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
                connectButton.setText("登录中…");
                testConnection(url, user, pass, new ResultCallback() {
                    @Override
                    public void onResult(final boolean ok, final String message, final String cookie) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                if (isFinishing() || isDestroyed()) {
                                    return;
                                }
                                connectButton.setEnabled(true);
                                connectButton.setText("登录");
                                if (ok) {
                                    serverUrl = url;
                                    username = user;
                                    password = pass;
                                    loggedIn = true;
                                    savePreferences();
                                    applySessionCookie(url, cookie);
                                    showWebScreen();
                                } else {
                                    showFormError(formError, message);
                                }
                            }
                        });
                    }
                });
            }
        });

        return scroll;
    }

    private void showWebScreen() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        setupScreen = false;
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
        FrameLayout.LayoutParams progressLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(3),
                Gravity.TOP);
        root.addView(progressBar, progressLp);

        errorView = buildErrorView();
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        errorView.setVisibility(View.GONE);

        setContentView(root);
        invalidateOptionsMenu();
        webView.loadUrl(serverUrl + "/");
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
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " FocusBoxAndroid/1.0.5");

        webView.setBackgroundColor(Color.WHITE);
        webView.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                Log.d("FocusBoxAndroid", "page started: " + url);
                errorShown = false;
                hideError();
                if (progressBar != null) {
                    progressBar.setProgress(0);
                    progressBar.setVisibility(View.VISIBLE);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                Log.d("FocusBoxAndroid", "page finished: " + view.getUrl()
                        + " title=" + view.getTitle());
                if (progressBar != null) {
                    progressBar.setVisibility(View.GONE);
                }
                if (!errorShown) {
                    hideError();
                }
            }

            @Override
            public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler,
                                                  String host, String realm) {
                Log.d("FocusBoxAndroid", "auth request host=" + host + " realm=" + realm);
                String expectedHost = normalizeHost(Uri.parse(serverUrl).getHost());
                String actualHost = normalizeHost(host);
                if (!expectedHost.isEmpty() && !actualHost.isEmpty()
                        && !expectedHost.equalsIgnoreCase(actualHost)) {
                    handler.cancel();
                    return;
                }
                if (TextUtils.isEmpty(username) && TextUtils.isEmpty(password)) {
                    handler.cancel();
                    showError("服务器需要登录，请填写用户名和密码。");
                    return;
                }
                handler.proceed(username, password);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse errorResponse) {
                Log.w("FocusBoxAndroid", "http error "
                        + errorResponse.getStatusCode() + " " + request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    if (progressBar != null) {
                        progressBar.setVisibility(View.GONE);
                    }
                    String detail = error == null ? "" : String.valueOf(error.getDescription());
                    Log.w("FocusBoxAndroid", "page error: " + detail);
                    showError("无法连接服务器，请检查地址、端口和网络。\n" + detail);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    String expectedHost = normalizeHost(Uri.parse(serverUrl).getHost());
                    String targetHost = normalizeHost(uri.getHost());
                    if (!expectedHost.isEmpty() && !targetHost.isEmpty()
                            && !expectedHost.equalsIgnoreCase(targetHost)) {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, uri));
                        } catch (Exception ignored) {
                        }
                        return true;
                    }
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
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
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
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
                if (fileName == null || fileName.isEmpty()) {
                    fileName = "focusbox-export.json";
                }
                pendingExportUrl = url;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(!TextUtils.isEmpty(mimeType) ? mimeType : "application/json");
                intent.putExtra(Intent.EXTRA_TITLE, fileName);
                try {
                    startActivityForResult(intent, REQUEST_SAVE_EXPORT);
                } catch (ActivityNotFoundException e) {
                    pendingExportUrl = null;
                    Toast.makeText(MainActivity.this,
                            "无法打开保存对话框", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private View buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.WHITE);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));

        TextView title = new TextView(this);
        title.setText("无法连接");
        title.setTextSize(20);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.rgb(17, 24, 39));
        title.setGravity(Gravity.CENTER);
        box.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        errorText = new TextView(this);
        errorText.setTextSize(14);
        errorText.setTextColor(Color.rgb(107, 114, 128));
        errorText.setGravity(Gravity.CENTER);
        errorText.setPadding(0, dp(12), 0, dp(24));
        box.addView(errorText, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        Button retry = new Button(this);
        retry.setText("重试");
        retry.setAllCaps(false);
        box.addView(retry, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        Button settings = new Button(this);
        settings.setText("修改服务器");
        settings.setAllCaps(false);
        LinearLayout.LayoutParams settingsLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        settingsLp.topMargin = dp(8);
        box.addView(settings, settingsLp);

        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (webView == null) {
                    return;
                }
                errorShown = false;
                hideError();
                webView.loadUrl(serverUrl + "/");
            }
        });

        settings.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showSettingsDialog();
            }
        });

        return box;
    }

    private void showSettingsDialog() {
        if (webView == null) {
            return;
        }

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

        final EditText userInput = createInput(
                InputType.TYPE_CLASS_TEXT,
                "用户名");
        userInput.setText(username);
        addField(form, "用户名", userInput);

        final EditText passInput = createInput(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD,
                "密码");
        passInput.setText(password);
        addField(form, "密码", passInput);

        final TextView formError = new TextView(this);
        formError.setTextSize(13);
        formError.setTextColor(Color.rgb(220, 38, 38));
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
                                        if (isFinishing() || isDestroyed() || !dialog.isShowing()) {
                                            return;
                                        }
                                        saveButton.setEnabled(true);
                                        saveButton.setText("保存并连接");
                                        if (!ok) {
                                            showFormError(formError, message);
                                            return;
                                        }
                                        serverUrl = url;
                                        username = user;
                                        password = pass;
                                        loggedIn = true;
                                        savePreferences();
                                        applySessionCookie(url, cookie);
                                        try {
                                            WebViewDatabase.getInstance(MainActivity.this)
                                                    .clearHttpAuthUsernamePassword();
                                        } catch (Exception ignored) {
                                        }
                                        dialog.dismiss();
                                        errorShown = false;
                                        hideError();
                                        webView.loadUrl(serverUrl + "/");
                                        Toast.makeText(MainActivity.this,
                                                "已保存", Toast.LENGTH_SHORT).show();
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
                    URL url = new URL(baseUrl + "/api/auth/login");
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(8000);
                    connection.setReadTimeout(12000);
                    connection.setInstanceFollowRedirects(true);
                    connection.setRequestMethod("POST");
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                    connection.setRequestProperty("Accept", "application/json");
                    String body = "{\"username\":\"" + jsonEscape(user)
                            + "\",\"password\":\"" + jsonEscape(pass) + "\"}";
                    byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(payload.length);
                    OutputStream output = connection.getOutputStream();
                    try {
                        output.write(payload);
                    } finally {
                        output.close();
                    }
                    int code = connection.getResponseCode();
                    String cookie = connection.getHeaderField("Set-Cookie");
                    if (code >= 200 && code < 300) {
                        callback.onResult(true, "", cookie);
                    } else if (code == 401) {
                        callback.onResult(false, "用户名或密码错误。", null);
                    } else if (code == 403) {
                        callback.onResult(false, "服务器拒绝访问（403）。", null);
                    } else if (code == 404) {
                        callback.onResult(false, "服务器可达，但未找到登录接口，请确认服务端版本。", null);
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
                    if (connection != null) {
                        connection.disconnect();
                    }
                }
            }
        }).start();
    }

    private static String jsonEscape(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    private void applySessionCookie(String baseUrl, String cookie) {
        if (TextUtils.isEmpty(cookie)) {
            return;
        }
        String pair = cookie.split(";", 2)[0];
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setCookie(baseUrl + "/", pair);
        cookieManager.flush();
    }

    private void performLogout() {
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
                    if (connection != null) {
                        connection.disconnect();
                    }
                }
            }
        }).start();

        username = "";
        password = "";
        loggedIn = false;
        savePreferences();

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.removeAllCookies(null);
        cookieManager.flush();
        try {
            WebViewDatabase.getInstance(this).clearHttpAuthUsernamePassword();
        } catch (Exception ignored) {
        }
        if (settingsDialog != null && settingsDialog.isShowing()) {
            settingsDialog.dismiss();
        }
        showSetupScreen();
        Toast.makeText(this, "已退出登录", Toast.LENGTH_SHORT).show();
    }

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
        input.setTextColor(Color.rgb(17, 24, 39));
        input.setHintTextColor(Color.rgb(156, 163, 175));
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
        if (view == null) {
            return;
        }
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) {
            imm.hideSoftInputFromWindow(view.getWindowToken(), 0);
        }
    }

    private void showError(String message) {
        errorShown = true;
        if (errorView == null || errorText == null) {
            return;
        }
        errorText.setText(message);
        errorView.setVisibility(View.VISIBLE);
        errorView.bringToFront();
    }

    private void hideError() {
        if (errorView != null) {
            errorView.setVisibility(View.GONE);
        }
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
        menu.add(Menu.NONE, MENU_LOGOUT, 2, "退出登录")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER);
        return true;
    }

    @Override
    public boolean onPrepareOptionsMenu(Menu menu) {
        boolean hasWebView = webView != null && !setupScreen;
        MenuItem refresh = menu.findItem(MENU_REFRESH);
        MenuItem settings = menu.findItem(MENU_SETTINGS);
        MenuItem logout = menu.findItem(MENU_LOGOUT);
        if (refresh != null) {
            refresh.setVisible(hasWebView);
        }
        if (settings != null) {
            settings.setVisible(hasWebView);
        }
        if (logout != null) {
            logout.setVisible(hasWebView);
        }
        return super.onPrepareOptionsMenu(menu);
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == MENU_REFRESH) {
            if (webView != null) {
                webView.reload();
            }
            return true;
        }
        if (item.getItemId() == MENU_SETTINGS) {
            showSettingsDialog();
            return true;
        }
        if (item.getItemId() == MENU_LOGOUT) {
            performLogout();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (filePathCallback == null) {
                return;
            }
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
            if (resultCode == RESULT_OK && data != null && data.getData() != null
                    && pendingExportUrl != null) {
                saveExport(data.getData(), pendingExportUrl);
            }
            pendingExportUrl = null;
        }
    }

    private void saveExport(final Uri target, final String url) {
        Toast.makeText(this, "正在导出…", Toast.LENGTH_SHORT).show();
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                InputStream input = null;
                OutputStream output = null;
                String message = "导出失败";
                boolean success = false;
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
                        if (output == null) {
                            throw new IllegalStateException("无法打开目标文件");
                        }
                        byte[] buffer = new byte[8192];
                        int read;
                        while ((read = input.read(buffer)) != -1) {
                            output.write(buffer, 0, read);
                        }
                        output.flush();
                        success = true;
                        message = "已导出到所选位置";
                    }
                } catch (Exception e) {
                    String detail = e.getMessage();
                    if (detail == null || detail.trim().isEmpty()) {
                        detail = e.getClass().getSimpleName();
                    }
                    message = "导出失败：" + detail;
                } finally {
                    try {
                        if (input != null) {
                            input.close();
                        }
                    } catch (Exception ignored) {
                    }
                    try {
                        if (output != null) {
                            output.close();
                        }
                    } catch (Exception ignored) {
                    }
                    if (connection != null) {
                        connection.disconnect();
                    }
                }
                final String finalMessage = message;
                final boolean finalSuccess = success;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (isFinishing() || isDestroyed()) {
                            return;
                        }
                        Toast.makeText(MainActivity.this,
                                finalMessage,
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
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (settingsDialog != null && settingsDialog.isShowing()) {
            settingsDialog.dismiss();
        }
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
