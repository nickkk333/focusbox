package com.nickkk333.focusbox;

import android.graphics.Color;
import android.graphics.Paint;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/** 任务列表行，今日页与任务页共用。 */
public final class TaskRow {
  private TaskRow() {}

  public static View build(
      final MainActivity app, final JSONObject task, final Runnable onChanged, final boolean showFocus) {
    final long id = Ui.longValue(task, "id", 0);
    final boolean daily = "daily".equals(Ui.str(task, "taskType"));
    final boolean done = "done".equals(Ui.str(task, "status"));
    final boolean checked = done || (daily && Ui.bool(task, "checkedToday"));

    LinearLayout row = Ui.row(app);
    row.setBackground(Ui.rounded(app, checked ? Color.parseColor("#F3FBF5") : Ui.CARD, Ui.BORDER, 14));
    row.setPadding(Ui.dp(app, 12), Ui.dp(app, 12), Ui.dp(app, 10), Ui.dp(app, 12));

    TextView check = Ui.text(app, checked ? "✓" : "", 14, Color.WHITE, true);
    check.setGravity(Gravity.CENTER);
    check.setBackground(
        Ui.rounded(app, checked ? Ui.SUCCESS : Ui.CARD, checked ? 0 : Ui.BORDER, 999));
    int size = Ui.dp(app, 24);
    LinearLayout.LayoutParams checkParams = new LinearLayout.LayoutParams(size, size);
    checkParams.rightMargin = Ui.dp(app, 12);
    row.addView(check, checkParams);
    check.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            toggle(app, task, daily, id, onChanged);
          }
        });

    LinearLayout main = Ui.column(app);
    row.addView(main, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

    String title = Ui.str(task, "title");
    TextView titleView = Ui.text(app, title.isEmpty() ? "未命名任务" : title, 15, checked ? Ui.MUTED : Ui.TEXT, true);
    if (checked) {
      titleView.setPaintFlags(titleView.getPaintFlags() | Paint.STRIKE_THRU_TEXT_FLAG);
    }
    main.addView(titleView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    String meta = metaText(task, daily);
    if (!meta.isEmpty()) {
      TextView metaView = Ui.text(app, meta, 12, Ui.MUTED, false);
      LinearLayout.LayoutParams metaParams =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      metaParams.topMargin = Ui.dp(app, 3);
      main.addView(metaView, metaParams);
    }

    if (showFocus) {
      TextView focus = Ui.text(app, "专注", 12, Ui.PRIMARY, true);
      focus.setPadding(Ui.dp(app, 8), Ui.dp(app, 6), Ui.dp(app, 4), Ui.dp(app, 6));
      focus.setOnClickListener(
          new View.OnClickListener() {
            @Override
            public void onClick(View view) {
              app.startFocus(task);
            }
          });
      row.addView(focus, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    row.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            TaskForm.showDetail(app, task, onChanged);
          }
        });
    row.setOnLongClickListener(
        new View.OnLongClickListener() {
          @Override
          public boolean onLongClick(View view) {
            TaskForm.confirmDelete(app, task, onChanged);
            return true;
          }
        });
    return row;
  }

  public static String metaText(JSONObject task, boolean daily) {
    StringBuilder meta = new StringBuilder();
    String projectName = Ui.str(task, "projectName");
    if (!projectName.isEmpty()) meta.append(projectName);
    if (daily) {
      if (meta.length() > 0) meta.append(" · ");
      meta.append("每日打卡");
      int checkinCount = Ui.intValue(task, "checkinCount", 0);
      if (checkinCount > 0) meta.append("（已打卡 ").append(checkinCount).append(" 天）");
    }
    int priority = Ui.intValue(task, "priority", 0);
    if (priority > 0) {
      if (meta.length() > 0) meta.append(" · ");
      meta.append(Ui.priorityLabel(priority)).append("优先级");
    }
    String dueDate = Ui.str(task, "dueDate");
    if (!dueDate.isEmpty()) {
      if (meta.length() > 0) meta.append(" · ");
      meta.append("截止 ").append(dueDate);
    }
    int focusSeconds = Ui.intValue(task, "focusSeconds", 0);
    if (focusSeconds > 0) {
      if (meta.length() > 0) meta.append(" · ");
      meta.append("已专注 ").append(Ui.durationText(focusSeconds));
    }
    int subtaskCount = Ui.intValue(task, "subtaskCount", 0);
    if (subtaskCount > 0) {
      if (meta.length() > 0) meta.append(" · ");
      meta.append("子任务 ").append(Ui.intValue(task, "subtaskDone", 0)).append("/").append(subtaskCount);
    }
    return meta.toString();
  }

  private static void toggle(
      final MainActivity app, JSONObject task, boolean daily, long id, final Runnable onChanged) {
    final String date = daily ? Ui.today() : null;
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return app.api().toggleTask(id, date);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            onChanged.run();
          }

          @Override
          public void onError(Exception error) {
            Ui.toast(app, error == null ? "操作失败" : error.getMessage());
          }
        });
  }
}
