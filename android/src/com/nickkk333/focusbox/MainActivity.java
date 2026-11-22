package com.nickkk333.focusbox;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * 原生客户端外壳：登录页 + 今日 / 任务 / 番茄钟 / 备忘 / 统计 五个标签页。
 */
public class MainActivity extends Activity {
  private static final int TAB_TODAY = 0;
  private static final int TAB_TASKS = 1;
  private static final int TAB_POMODORO = 2;
  private static final int TAB_MEMOS = 3;
  private static final int TAB_STATS = 4;
  private static final String[] TAB_TITLES = {"今日", "任务", "番茄", "备忘", "统计"};

  private SessionStore store;
  private ApiClient api;

  private FrameLayout content;
  private LinearLayout topBar;
  private LinearLayout navBar;
  private TextView titleView;
  private final TextView[] navItems = new TextView[TAB_TITLES.length];
  private final BaseScreen[] screens = new BaseScreen[TAB_TITLES.length];

  private int currentTab = TAB_TODAY;
  private boolean inApp = false;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    store = new SessionStore(this);
    api = new ApiClient(store);
    buildLayout();
    if (store.hasServer()) {
      connectSavedServer();
    } else {
      showLogin("");
    }
  }

  ApiClient api() {
    return api;
  }

  SessionStore store() {
    return store;
  }

  private void buildLayout() {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Ui.BG);

    topBar = Ui.row(this);
    topBar.setBackgroundColor(Color.WHITE);
    topBar.setElevation(Ui.dp(this, 2));
    int horizontal = Ui.dp(this, 16);
    int vertical = Ui.dp(this, 12);
    topBar.setPadding(horizontal, vertical, horizontal, vertical);

    titleView = Ui.text(this, TAB_TITLES[TAB_TODAY], 19, Ui.TEXT, true);
    topBar.addView(titleView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

    TextView refresh = Ui.text(this, "刷新", 14, Ui.PRIMARY, true);
    refresh.setPadding(Ui.dp(this, 10), Ui.dp(this, 6), Ui.dp(this, 10), Ui.dp(this, 6));
    refresh.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            refreshCurrent();
          }
        });
    topBar.addView(refresh, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    TextView logout = Ui.text(this, "退出", 14, Ui.MUTED, true);
    logout.setPadding(Ui.dp(this, 10), Ui.dp(this, 6), Ui.dp(this, 4), Ui.dp(this, 6));
    logout.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            confirmLogout();
          }
        });
    topBar.addView(logout, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    root.addView(topBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    content = new FrameLayout(this);
    root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

    navBar = new LinearLayout(this);
    navBar.setOrientation(LinearLayout.HORIZONTAL);
    navBar.setBackgroundColor(Color.WHITE);
    navBar.setElevation(Ui.dp(this, 8));
    for (int i = 0; i < TAB_TITLES.length; i++) {
      final int index = i;
      TextView item = Ui.text(this, TAB_TITLES[i], 13, Ui.MUTED, false);
      item.setGravity(Gravity.CENTER);
      item.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 12));
      item.setOnClickListener(
          new View.OnClickListener() {
            @Override
            public void onClick(View view) {
              if (inApp) selectTab(index);
            }
          });
      navItems[i] = item;
      navBar.addView(item, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    }
    root.addView(navBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    setContentView(root);
  }

  private void connectSavedServer() {
    showLoadingScreen("正在连接服务器…");
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.status();
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            if (value != null && value.optBoolean("authenticated", false)) {
              showApp();
            } else {
              showLogin("登录已失效，请重新登录");
            }
          }

          @Override
          public void onError(Exception error) {
            showLogin(error == null ? "无法连接服务器" : error.getMessage());
          }
        });
  }

  private void showLoadingScreen(String message) {
    inApp = false;
    topBar.setVisibility(View.GONE);
    navBar.setVisibility(View.GONE);
    content.removeAllViews();
    TextView view = Ui.text(this, message, 15, Ui.MUTED, false);
    view.setGravity(Gravity.CENTER);
    content.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
  }

  void showApp() {
    inApp = true;
    topBar.setVisibility(View.VISIBLE);
    navBar.setVisibility(View.VISIBLE);
    selectTab(TAB_TODAY);
  }

  void showLogin(String message) {
    inApp = false;
    topBar.setVisibility(View.GONE);
    navBar.setVisibility(View.GONE);
    content.removeAllViews();
    LoginScreen login = new LoginScreen(this);
    content.addView(login, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    if (message != null && !message.isEmpty()) login.setError(message);
  }

  void onLoginSuccess() {
    showApp();
  }

  void sessionExpired() {
    if (!inApp) return;
    store.setToken(null);
    store.setNoAuth(false);
    showLogin("登录已失效，请重新登录");
  }

  private void selectTab(int index) {
    if (index < 0 || index >= TAB_TITLES.length) return;
    currentTab = index;
    for (int i = 0; i < navItems.length; i++) {
      TextView item = navItems[i];
      if (item == null) continue;
      item.setTextColor(i == index ? Ui.PRIMARY : Ui.MUTED);
      item.setTypeface(Typeface.DEFAULT, i == index ? Typeface.BOLD : Typeface.NORMAL);
    }
    BaseScreen screen = screens[index];
    if (screen == null) {
      screen = createScreen(index);
      screens[index] = screen;
    }
    titleView.setText(screen.title());
    content.removeAllViews();
    content.addView(screen, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    if (inApp) screen.refresh();
  }

  private BaseScreen createScreen(int index) {
    switch (index) {
      case TAB_TASKS:
        return new TasksScreen(this);
      case TAB_POMODORO:
        return new PomodoroScreen(this);
      case TAB_MEMOS:
        return new MemosScreen(this);
      case TAB_STATS:
        return new StatsScreen(this);
      case TAB_TODAY:
      default:
        return new TodayScreen(this);
    }
  }

  private void refreshCurrent() {
    if (!inApp) return;
    BaseScreen screen = screens[currentTab];
    if (screen != null) screen.refresh();
  }

  /** 从任务列表跳转到番茄钟并关联任务。 */
  void startFocus(JSONObject task) {
    if (!inApp) return;
    selectTab(TAB_POMODORO);
    BaseScreen screen = screens[TAB_POMODORO];
    if (screen instanceof PomodoroScreen) {
      ((PomodoroScreen) screen).attachTask(task);
    }
  }

  void openMemos() {
    if (inApp) selectTab(TAB_MEMOS);
  }

  void openTasks() {
    if (inApp) selectTab(TAB_TASKS);
  }

  private void confirmLogout() {
    new AlertDialog.Builder(this)
        .setTitle("退出登录")
        .setMessage("将清除本地登录状态并返回登录页，服务器地址会保留。")
        .setPositiveButton(
            "退出",
            new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface dialog, int which) {
                doLogout();
              }
            })
        .setNegativeButton("取消", null)
        .show();
  }

  private void doLogout() {
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            api.logout();
            return null;
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            finishLogout();
          }

          @Override
          public void onError(Exception error) {
            finishLogout();
          }
        });
  }

  private void finishLogout() {
    store.clearSession();
    for (int i = 0; i < screens.length; i++) {
      if (screens[i] != null) {
        screens[i].dispose();
        screens[i] = null;
      }
    }
    showLogin("");
  }

  @Override
  public void onBackPressed() {
    if (inApp && currentTab != TAB_TODAY) {
      selectTab(TAB_TODAY);
      return;
    }
    super.onBackPressed();
  }

  @Override
  protected void onDestroy() {
    for (BaseScreen screen : screens) {
      if (screen != null) screen.dispose();
    }
    super.onDestroy();
  }
}
