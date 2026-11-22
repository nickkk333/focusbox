package com.nickkk333.focusbox;

import android.app.DatePickerDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.DatePicker;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * 轻量 UI 工具：用代码搭建界面，避免引入 XML 布局与第三方 UI 库。
 */
public final class Ui {
  public static final int BG = Color.parseColor("#F5F7FA");
  public static final int CARD = Color.WHITE;
  public static final int TEXT = Color.parseColor("#1F2937");
  public static final int MUTED = Color.parseColor("#6B7280");
  public static final int BORDER = Color.parseColor("#E5E7EB");
  public static final int PRIMARY = Color.parseColor("#4F46E5");
  public static final int PRIMARY_DARK = Color.parseColor("#3730A3");
  public static final int DANGER = Color.parseColor("#DC2626");
  public static final int SUCCESS = Color.parseColor("#16A34A");
  public static final int AMBER = Color.parseColor("#F59E0B");
  public static final int BLUE = Color.parseColor("#4C7BF4");
  public static final int SKY = Color.parseColor("#0EA5E9");

  private Ui() {}

  public static int dp(Context context, float value) {
    return Math.round(value * context.getResources().getDisplayMetrics().density);
  }

  public static LinearLayout column(Context context) {
    LinearLayout layout = new LinearLayout(context);
    layout.setOrientation(LinearLayout.VERTICAL);
    return layout;
  }

  public static LinearLayout row(Context context) {
    LinearLayout layout = new LinearLayout(context);
    layout.setOrientation(LinearLayout.HORIZONTAL);
    layout.setGravity(Gravity.CENTER_VERTICAL);
    return layout;
  }

  public static TextView text(Context context, CharSequence value, float sizeSp, int color, boolean bold) {
    TextView view = new TextView(context);
    view.setText(value);
    view.setTextSize(sizeSp);
    view.setTextColor(color);
    view.setTypeface(Typeface.DEFAULT, bold ? Typeface.BOLD : Typeface.NORMAL);
    return view;
  }

  public static TextView label(Context context, CharSequence value) {
    TextView view = text(context, value, 12, MUTED, true);
    view.setLetterSpacing(0.04f);
    return view;
  }

  public static TextView sectionTitle(Context context, CharSequence value) {
    return text(context, value, 16, TEXT, true);
  }

  public static LinearLayout card(Context context) {
    LinearLayout card = column(context);
    card.setBackground(rounded(context, CARD, BORDER, 16));
    card.setElevation(dp(context, 1));
    int padding = dp(context, 16);
    card.setPadding(padding, padding, padding, padding);
    return card;
  }

  public static LinearLayout.LayoutParams cardParams(Context context) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.topMargin = dp(context, 12);
    return params;
  }

  public static GradientDrawable rounded(Context context, int fill, int strokeColor, float radiusDp) {
    GradientDrawable drawable = new GradientDrawable();
    drawable.setShape(GradientDrawable.RECTANGLE);
    drawable.setColor(fill);
    drawable.setCornerRadius(dp(context, radiusDp));
    if (strokeColor != 0) {
      drawable.setStroke(dp(context, 1), strokeColor);
    }
    return drawable;
  }

  public static TextView button(Context context, String label, boolean primary) {
    TextView view = text(context, label, 15, primary ? Color.WHITE : TEXT, true);
    view.setGravity(Gravity.CENTER);
    view.setBackground(rounded(context, primary ? PRIMARY : CARD, primary ? 0 : BORDER, 12));
    int horizontal = dp(context, 16);
    int vertical = dp(context, 11);
    view.setPadding(horizontal, vertical, horizontal, vertical);
    view.setClickable(true);
    view.setFocusable(true);
    return view;
  }

  public static TextView chip(Context context, String label, boolean selected) {
    TextView view = text(context, label, 13, selected ? Color.WHITE : MUTED, selected);
    view.setGravity(Gravity.CENTER);
    view.setBackground(rounded(context, selected ? PRIMARY : CARD, selected ? 0 : BORDER, 999));
    int horizontal = dp(context, 14);
    int vertical = dp(context, 7);
    view.setPadding(horizontal, vertical, horizontal, vertical);
    view.setClickable(true);
    view.setFocusable(true);
    return view;
  }

  public static EditText field(Context context, String hint, int inputType) {
    EditText view = input(context, hint, inputType);
    view.setSingleLine(true);
    return view;
  }

  public static EditText area(Context context, String hint, int minLines) {
    EditText view = input(context, hint, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
    view.setSingleLine(false);
    view.setMinLines(minLines);
    view.setGravity(Gravity.TOP | Gravity.START);
    return view;
  }

  private static EditText input(Context context, String hint, int inputType) {
    EditText view = new EditText(context);
    view.setHint(hint);
    view.setHintTextColor(MUTED);
    view.setTextColor(TEXT);
    view.setTextSize(15);
    view.setInputType(inputType);
    view.setBackground(rounded(context, CARD, BORDER, 12));
    int horizontal = dp(context, 14);
    int vertical = dp(context, 11);
    view.setPadding(horizontal, vertical, horizontal, vertical);
    return view;
  }

  public static View divider(Context context) {
    View view = new View(context);
    view.setBackgroundColor(BORDER);
    view.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(context, 1))));
    return view;
  }

  public static View spacer(Context context, float heightDp) {
    View view = new View(context);
    view.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, heightDp)));
    return view;
  }

  public static void toast(Context context, String message) {
    if (message == null || message.isEmpty()) return;
    Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
  }

  public static String str(JSONObject object, String key) {
    if (object == null || !object.has(key) || object.isNull(key)) return "";
    String value = object.optString(key, "");
    return "null".equals(value) ? "" : value;
  }

  public static int intValue(JSONObject object, String key, int fallback) {
    if (object == null || object.isNull(key)) return fallback;
    return object.optInt(key, fallback);
  }

  public static long longValue(JSONObject object, String key, long fallback) {
    if (object == null || object.isNull(key)) return fallback;
    return object.optLong(key, fallback);
  }

  public static boolean bool(JSONObject object, String key) {
    return object != null && object.optBoolean(key, false);
  }

  public static JSONArray array(JSONObject object, String key) {
    if (object == null) return new JSONArray();
    JSONArray value = object.optJSONArray(key);
    return value == null ? new JSONArray() : value;
  }

  public static JSONObject object(JSONObject object, String key) {
    if (object == null) return new JSONObject();
    JSONObject value = object.optJSONObject(key);
    return value == null ? new JSONObject() : value;
  }

  public static JSONObject item(JSONArray array, int index) {
    if (array == null || index < 0 || index >= array.length()) return new JSONObject();
    JSONObject value = array.optJSONObject(index);
    return value == null ? new JSONObject() : value;
  }

  public static String durationText(int seconds) {
    if (seconds <= 0) return "0 分钟";
    int minutes = Math.round(seconds / 60f);
    return minutesText(minutes);
  }

  public static String minutesText(int minutes) {
    if (minutes <= 0) return "0 分钟";
    if (minutes < 60) return minutes + " 分钟";
    int hours = minutes / 60;
    int rest = minutes % 60;
    return rest == 0 ? hours + " 小时" : hours + " 小时 " + rest + " 分钟";
  }

  public static int color(String value, int fallback) {
    if (value == null) return fallback;
    String text = value.trim();
    if (!text.startsWith("#")) return fallback;
    try {
      return Color.parseColor(text);
    } catch (Exception error) {
      return fallback;
    }
  }

  public static View dot(Context context, int color, float sizeDp) {
    View view = new View(context);
    view.setBackground(rounded(context, color, 0, 999));
    int size = dp(context, sizeDp);
    view.setLayoutParams(new LinearLayout.LayoutParams(size, size));
    return view;
  }

  public static String priorityLabel(int priority) {
    switch (priority) {
      case 3:
        return "高";
      case 2:
        return "中";
      case 1:
        return "低";
      default:
        return "无";
    }
  }

  public static int priorityColor(int priority) {
    switch (priority) {
      case 3:
        return DANGER;
      case 2:
        return AMBER;
      case 1:
        return BLUE;
      default:
        return MUTED;
    }
  }

  public static String today() {
    return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
  }

  /** 与浏览器 getTimezoneOffset() 一致：本地时间比 UTC 慢多少分钟，中国为 -480。 */
  public static int tzOffset() {
    return -(TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000);
  }

  public static String nowIso() {
    SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    format.setTimeZone(TimeZone.getTimeZone("UTC"));
    return format.format(new Date());
  }

  public static Date parseIso(String iso) {
    if (iso == null || iso.isEmpty()) return null;
    String[] patterns = {"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'"};
    for (String pattern : patterns) {
      try {
        SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        Date value = format.parse(iso);
        if (value != null) return value;
      } catch (Exception ignored) {
        // 尝试下一个格式
      }
    }
    return null;
  }

  public static String formatIso(String iso, String pattern) {
    Date date = parseIso(iso);
    if (date == null) return "";
    return new SimpleDateFormat(pattern, Locale.getDefault()).format(date);
  }

  public static String formatClock(long millis) {
    long totalSeconds = Math.max(0, millis / 1000);
    return String.format(Locale.US, "%02d:%02d", totalSeconds / 60, totalSeconds % 60);
  }

  public interface DateCallback {
    void onDate(String value);
  }

  public static TextView dateField(Context context, String hint) {
    TextView view = text(context, hint, 15, MUTED, false);
    view.setBackground(rounded(context, CARD, BORDER, 12));
    int horizontal = dp(context, 14);
    int vertical = dp(context, 11);
    view.setPadding(horizontal, vertical, horizontal, vertical);
    view.setClickable(true);
    view.setFocusable(true);
    return view;
  }

  public static void pickDate(Context context, String initial, final DateCallback callback) {
    Calendar calendar = Calendar.getInstance();
    if (initial != null && initial.length() >= 10) {
      try {
        String[] parts = initial.split("-");
        calendar.set(
            Integer.parseInt(parts[0]),
            Integer.parseInt(parts[1]) - 1,
            Integer.parseInt(parts[2]));
      } catch (Exception ignored) {
        // 使用今天
      }
    }
    new DatePickerDialog(
            context,
            new DatePickerDialog.OnDateSetListener() {
              @Override
              public void onDateSet(DatePicker view, int year, int month, int dayOfMonth) {
                callback.onDate(String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, dayOfMonth));
              }
            },
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH),
            calendar.get(Calendar.DAY_OF_MONTH))
        .show();
  }
}
