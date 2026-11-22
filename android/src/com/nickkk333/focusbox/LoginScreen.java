package com.nickkk333.focusbox;

import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

/** 登录页：填写服务器地址、用户名与密码。 */
public class LoginScreen extends LinearLayout {
  private final MainActivity app;
  private final SessionStore store;
  private final EditText serverField;
  private final EditText userField;
  private final EditText passField;
  private final CheckBox rememberBox;
  private final TextView loginButton;
  private final TextView errorView;

  private boolean loading;

  public LoginScreen(MainActivity app) {
    super(app);
    this.app = app;
    this.store = app.store();
    setOrientation(VERTICAL);
    setBackgroundColor(Ui.BG);

    ScrollView scroll = new ScrollView(app);
    scroll.setFillViewport(true);

    LinearLayout column = Ui.column(app);
    int side = Ui.dp(app, 24);
    column.setPadding(side, Ui.dp(app, 44), side, side);

    TextView brand = Ui.text(app, "专注盒子", 30, Ui.TEXT, true);
    column.addView(brand);

    TextView subtitle = Ui.text(app, "连接你的 FocusBox 自托管服务器", 14, Ui.MUTED, false);
    LinearLayout.LayoutParams subtitleParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    subtitleParams.topMargin = Ui.dp(app, 6);
    column.addView(subtitle, subtitleParams);

    LinearLayout card = Ui.card(app);
    LinearLayout.LayoutParams cardParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    cardParams.topMargin = Ui.dp(app, 24);
    column.addView(card, cardParams);

    card.addView(Ui.label(app, "服务器地址"));
    serverField =
        Ui.field(app, "http://192.168.1.20:8083", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
    serverField.setText(store.getServer());
    card.addView(serverField, fieldParams());

    card.addView(Ui.label(app, "用户名"));
    userField = Ui.field(app, "用户名（未启用登录可留空）", InputType.TYPE_CLASS_TEXT);
    userField.setText(store.getUsername());
    card.addView(userField, fieldParams());

    card.addView(Ui.label(app, "密码"));
    passField = Ui.field(app, "密码（未启用登录可留空）", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    passField.setText(store.getPassword());
    passField.setImeOptions(EditorInfo.IME_ACTION_DONE);
    card.addView(passField, fieldParams());

    rememberBox = new CheckBox(app);
    rememberBox.setText("记住密码");
    rememberBox.setTextColor(Ui.TEXT);
    rememberBox.setTextSize(14);
    rememberBox.setChecked(store.isRememberPassword());
    card.addView(rememberBox);

    loginButton = Ui.button(app, "登录", true);
    LinearLayout.LayoutParams buttonParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    buttonParams.topMargin = Ui.dp(app, 8);
    card.addView(loginButton, buttonParams);

    errorView = Ui.text(app, "", 13, Ui.DANGER, false);
    errorView.setGravity(Gravity.CENTER);
    errorView.setVisibility(View.GONE);
    LinearLayout.LayoutParams errorParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    errorParams.topMargin = Ui.dp(app, 10);
    card.addView(errorView, errorParams);

    TextView hint =
        Ui.text(
            app,
            "服务器地址就是浏览器访问的地址，无需添加 /api。服务器未启用登录时，用户名和密码可以留空。",
            12,
            Ui.MUTED,
            false);
    LinearLayout.LayoutParams hintParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    hintParams.topMargin = Ui.dp(app, 16);
    column.addView(hint, hintParams);

    scroll.addView(column, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    loginButton.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            submit();
          }
        });
    passField.setOnEditorActionListener(
        new TextView.OnEditorActionListener() {
          @Override
          public boolean onEditorAction(TextView view, int actionId, android.view.KeyEvent event) {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
              submit();
              return true;
            }
            return false;
          }
        });
  }

  private LinearLayout.LayoutParams fieldParams() {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.topMargin = Ui.dp(app, 8);
    params.bottomMargin = Ui.dp(app, 14);
    return params;
  }

  public void setError(String message) {
    if (message == null || message.isEmpty()) {
      errorView.setText("");
      errorView.setVisibility(View.GONE);
    } else {
      errorView.setText(message);
      errorView.setVisibility(View.VISIBLE);
    }
  }

  private void setLoading(boolean value) {
    loading = value;
    loginButton.setEnabled(!value);
    loginButton.setText(value ? "正在连接…" : "登录");
    loginButton.setAlpha(value ? 0.6f : 1f);
  }

  private void submit() {
    if (loading) return;
    final String server = serverField.getText().toString().trim();
    if (server.isEmpty()) {
      setError("请填写服务器地址，例如 http://192.168.1.20:8083");
      return;
    }
    final String username = userField.getText().toString().trim();
    final String password = passField.getText().toString();
    final boolean remember = rememberBox.isChecked();

    store.setRememberPassword(remember);
    setLoading(true);
    setError("");

    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return app.api().login(server, username, password);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            setLoading(false);
            if (!remember) store.setPassword("");
            app.onLoginSuccess();
          }

          @Override
          public void onError(Exception error) {
            setLoading(false);
            setError(error == null ? "登录失败" : error.getMessage());
          }
        });
  }
}
