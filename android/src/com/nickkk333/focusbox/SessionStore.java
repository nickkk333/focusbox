package com.nickkk333.focusbox;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * 保存服务器地址、账号与会话 Cookie，凭据只存放在应用私有目录。
 */
public final class SessionStore {
  private static final String PREFS = "focusbox_client";
  private static final String KEY_SERVER = "server";
  private static final String KEY_USERNAME = "username";
  private static final String KEY_PASSWORD = "password";
  private static final String KEY_TOKEN = "token";
  private static final String KEY_REMEMBER = "remember_password";
  private static final String KEY_NO_AUTH = "no_auth";

  private final SharedPreferences prefs;

  public SessionStore(Context context) {
    prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  public String getServer() {
    return prefs.getString(KEY_SERVER, "");
  }

  public void setServer(String server) {
    prefs.edit().putString(KEY_SERVER, server == null ? "" : server).apply();
  }

  public String getUsername() {
    return prefs.getString(KEY_USERNAME, "");
  }

  public void setUsername(String username) {
    prefs.edit().putString(KEY_USERNAME, username == null ? "" : username).apply();
  }

  public String getPassword() {
    return prefs.getString(KEY_PASSWORD, "");
  }

  public void setPassword(String password) {
    prefs.edit().putString(KEY_PASSWORD, password == null ? "" : password).apply();
  }

  public String getToken() {
    return prefs.getString(KEY_TOKEN, "");
  }

  public void setToken(String token) {
    if (token == null || token.isEmpty()) {
      prefs.edit().remove(KEY_TOKEN).apply();
    } else {
      prefs.edit().putString(KEY_TOKEN, token).apply();
    }
  }

  public boolean isRememberPassword() {
    return prefs.getBoolean(KEY_REMEMBER, true);
  }

  public void setRememberPassword(boolean remember) {
    prefs.edit().putBoolean(KEY_REMEMBER, remember).apply();
  }

  public boolean isNoAuth() {
    return prefs.getBoolean(KEY_NO_AUTH, false);
  }

  public void setNoAuth(boolean noAuth) {
    prefs.edit().putBoolean(KEY_NO_AUTH, noAuth).apply();
  }

  public boolean hasServer() {
    return !getServer().trim().isEmpty();
  }

  /** 退出登录：清除会话，保留服务器地址与用户名，方便再次连接。 */
  public void clearSession() {
    SharedPreferences.Editor editor = prefs.edit().remove(KEY_TOKEN).putBoolean(KEY_NO_AUTH, false);
    if (!isRememberPassword()) {
      editor.remove(KEY_PASSWORD);
    }
    editor.apply();
  }

  public void forgetEverything() {
    prefs.edit().clear().apply();
  }
}
