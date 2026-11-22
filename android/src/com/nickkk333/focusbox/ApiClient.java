package com.nickkk333.focusbox;

import android.util.Base64;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * FocusBox REST 客户端。会话使用 HttpOnly Cookie，同时保留 HTTP Basic 作为兼容回退。
 */
public final class ApiClient {
  private static final String COOKIE_NAME = "focusbox_session";
  private static final int CONNECT_TIMEOUT = 8000;
  private static final int READ_TIMEOUT = 20000;

  private final SessionStore store;

  public ApiClient(SessionStore store) {
    this.store = store;
  }

  public SessionStore store() {
    return store;
  }

  public String baseUrl() {
    String server = store.getServer();
    if (server == null) return "";
    server = server.trim();
    if (server.isEmpty()) return "";
    if (!server.startsWith("http://") && !server.startsWith("https://")) {
      server = "http://" + server;
    }
    while (server.endsWith("/")) {
      server = server.substring(0, server.length() - 1);
    }
    return server;
  }

  public static String enc(String value) {
    try {
      return URLEncoder.encode(value == null ? "" : value, "UTF-8");
    } catch (Exception error) {
      return "";
    }
  }

  public JSONObject get(String path) throws ApiException {
    return request("GET", path, null);
  }

  public JSONObject post(String path, JSONObject body) throws ApiException {
    return request("POST", path, body);
  }

  public JSONObject patch(String path, JSONObject body) throws ApiException {
    return request("PATCH", path, body);
  }

  public JSONObject delete(String path) throws ApiException {
    return request("DELETE", path, null);
  }

  // ---------- 业务封装 ----------

  public JSONObject login(String server, String username, String password) throws ApiException {
    store.setServer(server);
    store.setUsername(username);
    store.setPassword(password);
    store.setToken(null);
    JSONObject body = new JSONObject();
    try {
      body.put("username", username == null ? "" : username);
      body.put("password", password == null ? "" : password);
    } catch (Exception ignored) {
      // JSONObject 不会因字符串写入失败
    }
    JSONObject result = post("/api/auth/login", body);
    store.setNoAuth(!result.optBoolean("enabled", true));
    return result;
  }

  public JSONObject status() throws ApiException {
    return get("/api/auth/status");
  }

  public void logout() throws ApiException {
    post("/api/auth/logout", new JSONObject());
  }

  public JSONObject badges(String date, int tzOffset) throws ApiException {
    return get("/api/badges?date=" + enc(date) + "&tzOffset=" + tzOffset);
  }

  public JSONObject tasks(String query) throws ApiException {
    return get("/api/tasks" + (query == null || query.isEmpty() ? "" : "?" + query));
  }

  public JSONObject createTask(JSONObject body) throws ApiException {
    return post("/api/tasks", body);
  }

  public JSONObject toggleTask(long id, String date) throws ApiException {
    JSONObject body = new JSONObject();
    if (date != null && !date.isEmpty()) {
      try {
        body.put("date", date);
      } catch (Exception ignored) {
        // 忽略
      }
    }
    return post("/api/tasks/" + id + "/toggle", body);
  }

  public JSONObject deleteTask(long id) throws ApiException {
    return delete("/api/tasks/" + id);
  }

  public JSONObject taskDetail(long id, String date) throws ApiException {
    return get("/api/tasks/" + id + "?date=" + enc(date));
  }

  public JSONObject updateTask(long id, JSONObject body) throws ApiException {
    return patch("/api/tasks/" + id, body);
  }

  public JSONObject createSubtask(long taskId, String title) throws ApiException {
    JSONObject body = new JSONObject();
    try {
      body.put("title", title);
    } catch (Exception ignored) {
      // JSONObject 写入不会失败
    }
    return post("/api/tasks/" + taskId + "/subtasks", body);
  }

  public JSONObject updateSubtask(long subtaskId, JSONObject body) throws ApiException {
    return patch("/api/tasks/subtasks/" + subtaskId, body);
  }

  public JSONObject deleteSubtask(long subtaskId) throws ApiException {
    return delete("/api/tasks/subtasks/" + subtaskId);
  }

  public JSONObject addTime(long taskId, int minutes, String note) throws ApiException {
    JSONObject body = new JSONObject();
    try {
      body.put("minutes", minutes);
      body.put("note", note == null ? "" : note);
    } catch (Exception ignored) {
      // JSONObject 写入不会失败
    }
    return post("/api/tasks/" + taskId + "/time", body);
  }

  public JSONObject deleteTime(long entryId) throws ApiException {
    return delete("/api/tasks/time/" + entryId);
  }

  public JSONObject projects() throws ApiException {
    return get("/api/projects?date=" + enc(Ui.today()));
  }

  public JSONObject settings() throws ApiException {
    return get("/api/settings");
  }

  public JSONObject memos(String query) throws ApiException {
    return get("/api/memos" + (query == null || query.isEmpty() ? "" : "?" + query));
  }

  public JSONObject createMemo(String content) throws ApiException {
    JSONObject body = new JSONObject();
    try {
      body.put("content", content);
    } catch (Exception ignored) {
      // 忽略
    }
    return post("/api/memos", body);
  }

  public JSONObject updateMemo(long id, JSONObject body) throws ApiException {
    return patch("/api/memos/" + id, body);
  }

  public JSONObject deleteMemo(long id) throws ApiException {
    return delete("/api/memos/" + id);
  }

  public JSONObject stats(int days, int tzOffset, String date) throws ApiException {
    return get("/api/stats?days=" + days + "&tzOffset=" + tzOffset + "&date=" + enc(date));
  }

  public JSONObject postSession(JSONObject body) throws ApiException {
    return post("/api/sessions", body);
  }

  // ---------- 请求实现 ----------

  private JSONObject request(String method, String path, JSONObject body) throws ApiException {
    String base = baseUrl();
    if (base.isEmpty()) {
      throw new ApiException(0, "请先填写服务器地址");
    }
    HttpURLConnection connection = null;
    try {
      URL url = new URL(base + path);
      connection = (HttpURLConnection) url.openConnection();
      connection.setRequestMethod(method);
      connection.setConnectTimeout(CONNECT_TIMEOUT);
      connection.setReadTimeout(READ_TIMEOUT);
      connection.setRequestProperty("Accept", "application/json");
      connection.setRequestProperty("User-Agent", "FocusBoxAndroid/1.0.8");
      connection.setInstanceFollowRedirects(true);

      String token = store.getToken();
      if (token != null && !token.isEmpty()) {
        connection.setRequestProperty("Cookie", COOKIE_NAME + "=" + token);
      }
      String username = store.getUsername();
      String password = store.getPassword();
      if (username != null && !username.isEmpty()) {
        String raw = username + ":" + (password == null ? "" : password);
        connection.setRequestProperty(
            "Authorization",
            "Basic " + Base64.encodeToString(raw.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
      }

      if (body != null) {
        byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setFixedLengthStreamingMode(payload.length);
        OutputStream output = connection.getOutputStream();
        try {
          output.write(payload);
          output.flush();
        } finally {
          output.close();
        }
      }

      int code = connection.getResponseCode();
      captureCookie(connection);
      InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
      String text = readAll(stream);
      JSONObject json;
      try {
        json = text.isEmpty() ? new JSONObject() : new JSONObject(text);
      } catch (Exception parseError) {
        json = new JSONObject();
      }
      if (code >= 400) {
        String message = Ui.str(json, "error");
        if (message.isEmpty()) message = "请求失败（HTTP " + code + "）";
        throw new ApiException(code, message);
      }
      return json;
    } catch (ApiException error) {
      throw error;
    } catch (Exception error) {
      String message = error.getMessage();
      throw new ApiException(0, "无法连接服务器" + (message == null || message.isEmpty() ? "" : "：" + message));
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  private void captureCookie(HttpURLConnection connection) {
    try {
      Map<String, List<String>> headers = connection.getHeaderFields();
      if (headers == null) return;
      List<String> values = null;
      for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
        String key = entry.getKey();
        if (key != null && "Set-Cookie".equalsIgnoreCase(key)) {
          values = entry.getValue();
          break;
        }
      }
      if (values == null) return;
      for (String value : values) {
        if (value == null) continue;
        String pair = value.split(";", 2)[0];
        int index = pair.indexOf('=');
        if (index <= 0) continue;
        String name = pair.substring(0, index).trim();
        String cookieValue = pair.substring(index + 1).trim();
        if (COOKIE_NAME.equals(name)) {
          if (cookieValue.isEmpty()) {
            store.setToken(null);
          } else {
            store.setToken(cookieValue);
          }
        }
      }
    } catch (Exception ignored) {
      // 解析失败时保留旧会话
    }
  }

  private static String readAll(InputStream stream) throws Exception {
    if (stream == null) return "";
    BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
    StringBuilder builder = new StringBuilder();
    try {
      char[] buffer = new char[4096];
      int length;
      while ((length = reader.read(buffer)) != -1) {
        builder.append(buffer, 0, length);
      }
    } finally {
      reader.close();
    }
    return builder.toString();
  }
}
