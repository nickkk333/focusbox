package com.nickkk333.focusbox;

import android.widget.LinearLayout;

/** 主界面各功能页的基类。页面实例常驻内存，切换标签不会丢失状态。 */
public abstract class BaseScreen extends LinearLayout {
  protected final MainActivity app;
  protected final ApiClient api;

  public BaseScreen(MainActivity app) {
    super(app);
    this.app = app;
    this.api = app.api();
    setOrientation(VERTICAL);
    setBackgroundColor(Ui.BG);
  }

  /** 顶部标题栏显示的名称。 */
  public abstract String title();

  /** 进入页面或点击刷新时调用。 */
  public void refresh() {}

  /** 页面被销毁时释放资源（例如计时器回调）。 */
  public void dispose() {}

  protected void toast(String message) {
    Ui.toast(app, message);
  }

  protected void showError(Exception error) {
    String message = error == null ? "操作失败" : error.getMessage();
    if (message == null || message.isEmpty()) message = "操作失败";
    toast(message);
  }

  /** 统一处理接口异常：401 回到登录页，其余提示错误。 */
  protected boolean handleApiError(Exception error) {
    if (error instanceof ApiException && ((ApiException) error).isUnauthorized()) {
      app.sessionExpired();
      return true;
    }
    showError(error);
    return false;
  }
}
