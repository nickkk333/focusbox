package com.nickkk333.focusbox;

import android.app.AlertDialog;
import android.app.Dialog;
import android.content.DialogInterface;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * 任务详情页，内容与网页端详情抽屉保持一致：
 * 状态与标题、项目 / 优先级 / 时长 / 日期 / 备注、每日打卡日历、子任务、时间记录与删除。
 */
public final class TaskDetailPage {
  private static final String[] PRIORITY_LABELS = {"无", "低", "中", "高"};
  private static final String[] WEEKDAYS = {"一", "二", "三", "四", "五", "六", "日"};

  private static final Runnable NOOP =
      new Runnable() {
        @Override
        public void run() {}
      };

  private final MainActivity app;
  private final ApiClient api;
  private final long taskId;
  private final Runnable onChanged;

  private Dialog dialog;
  private LinearLayout body;

  private JSONObject task = new JSONObject();
  private JSONArray subtasks = new JSONArray();
  private JSONArray timeEntries = new JSONArray();
  private JSONArray sessions = new JSONArray();
  private JSONArray projects = new JSONArray();
  private String[] checkins = new String[0];

  private String draftTitle = "";
  private String draftNotes = "";
  private String draftStart = "";
  private String draftDue = "";
  private String draftEstimate = "";
  private int draftPriority;
  private long draftProjectId;
  private boolean draftReady;

  private TaskDetailPage(MainActivity app, long taskId, Runnable onChanged) {
    this.app = app;
    this.api = app.api();
    this.taskId = taskId;
    this.onChanged = onChanged == null ? NOOP : onChanged;
  }

  public static void show(MainActivity app, JSONObject summary, Runnable onChanged) {
    long id = Ui.longValue(summary, "id", 0);
    if (id <= 0) return;
    new TaskDetailPage(app, id, onChanged).load();
  }

  // ---------- 数据 ----------

  private static final class DetailData {
    JSONObject detail = new JSONObject();
    JSONObject projects = new JSONObject();
  }

  private void load() {
    Async.run(
        new Async.Work<DetailData>() {
          @Override
          public DetailData run() throws Exception {
            DetailData data = new DetailData();
            data.detail = api.taskDetail(taskId, Ui.today());
            data.projects = api.projects();
            return data;
          }
        },
        new Async.Done<DetailData>() {
          @Override
          public void onSuccess(DetailData data) {
            apply(data);
            if (dialog == null) {
              open();
            } else {
              render();
            }
          }

          @Override
          public void onError(Exception error) {
            handleError(error);
          }
        });
  }

  private void apply(DetailData data) {
    task = Ui.object(data.detail, "task");
    subtasks = Ui.array(data.detail, "subtasks");
    timeEntries = Ui.array(data.detail, "timeEntries");
    sessions = Ui.array(data.detail, "sessions");
    projects = Ui.array(data.projects, "projects");

    JSONArray dates = Ui.array(data.detail, "checkins");
    checkins = new String[dates.length()];
    for (int i = 0; i < dates.length(); i++) {
      checkins[i] = dates.optString(i);
    }

    if (!draftReady) {
      initDraft();
      draftReady = true;
    }
  }

  private void initDraft() {
    draftTitle = Ui.str(task, "title");
    draftNotes = Ui.str(task, "notes");
    draftStart = Ui.str(task, "startDate");
    draftDue = Ui.str(task, "dueDate");
    int estimate = Ui.intValue(task, "estimateMinutes", 0);
    draftEstimate = estimate > 0 ? String.valueOf(estimate) : "";
    draftPriority = Ui.intValue(task, "priority", 0);
    draftProjectId = Ui.longValue(task, "projectId", 0);
  }

  // ---------- 详情容器 ----------

  private void open() {
    dialog = new Dialog(app);
    dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

    LinearLayout root = Ui.column(app);
    root.setBackgroundColor(Ui.CARD);
    root.addView(buildTopBar(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    ScrollView scroll = new ScrollView(app);
    scroll.setFillViewport(true);
    body = Ui.column(app);
    int side = Ui.dp(app, 20);
    body.setPadding(side, 0, side, Ui.dp(app, 28));
    scroll.addView(
        body,
        new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

    dialog.setContentView(root);
    dialog.setOnDismissListener(
        new DialogInterface.OnDismissListener() {
          @Override
          public void onDismiss(DialogInterface ignored) {
            onChanged.run();
          }
        });
    render();
    dialog.show();

    Window window = dialog.getWindow();
    if (window != null) {
      window.setBackgroundDrawable(new ColorDrawable(Color.WHITE));
      window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
      window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }
  }

  private View buildTopBar() {
    LinearLayout bar = Ui.row(app);
    bar.setBackgroundColor(Ui.CARD);
    bar.setElevation(Ui.dp(app, 2));
    bar.setPadding(Ui.dp(app, 16), Ui.dp(app, 10), Ui.dp(app, 16), Ui.dp(app, 10));

    TextView close = Ui.text(app, "关闭", 14, Ui.MUTED, true);
    close.setPadding(Ui.dp(app, 6), Ui.dp(app, 6), Ui.dp(app, 6), Ui.dp(app, 6));
    close.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            if (dialog != null) dialog.dismiss();
          }
        });
    bar.addView(close);

    TextView heading = Ui.text(app, "任务详情", 17, Ui.TEXT, true);
    heading.setGravity(Gravity.CENTER);
    bar.addView(heading, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

    TextView save = Ui.text(app, "保存", 14, Ui.PRIMARY, true);
    save.setPadding(Ui.dp(app, 6), Ui.dp(app, 6), Ui.dp(app, 6), Ui.dp(app, 6));
    save.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            saveTask();
          }
        });
    bar.addView(save);
    return bar;
  }

  private void render() {
    if (body == null) return;
    body.removeAllViews();

    final boolean daily = "daily".equals(Ui.str(task, "taskType"));
    final String today = Ui.today();
    String start = Ui.str(task, "startDate");
    String due = Ui.str(task, "dueDate");
    boolean inRange = isInRange(today, start, due);
    boolean done = "done".equals(Ui.str(task, "status"));
    boolean checkedToday = containsDate(today);
    boolean checked = daily ? checkedToday : done;

    body.addView(buildStatusRow(daily, inRange, checked, checkedToday, done, start, today));
    body.addView(buildTitleField(), block(14));

    addLabel("所属项目");
    body.addView(buildProjectSpinner(), block(6));

    addLabel("优先级");
    body.addView(buildPriorityChips(), block(6));

    addLabel("预计时长（分钟）");
    body.addView(buildEstimateField(), block(6));

    addLabel(daily ? "开始日期 / 结束日期" : "开始日期 / 截止日期");
    body.addView(buildDateRow(daily), block(6));

    addLabel("备注");
    body.addView(buildNotesField(), block(6));

    if (daily) {
      addLabel("打卡日历");
      body.addView(buildCalendar(), block(8));
    }

    body.addView(buildSubtasksSection(), block(18));
    body.addView(buildTimeSection(), block(18));
    body.addView(buildDeleteButton(), block(22));
  }

  private View buildStatusRow(
      final boolean daily,
      boolean inRange,
      boolean checked,
      boolean checkedToday,
      boolean done,
      String start,
      String today) {
    LinearLayout row = Ui.row(app);

    int size = Ui.dp(app, 26);
    TextView check = Ui.text(app, checked ? "✓" : "", 14, Color.WHITE, true);
    check.setGravity(Gravity.CENTER);
    check.setBackground(Ui.rounded(app, checked ? Ui.SUCCESS : Ui.CARD, checked ? 0 : Ui.BORDER, 999));
    row.addView(check, new LinearLayout.LayoutParams(size, size));

    LinearLayout column = Ui.column(app);
    LinearLayout.LayoutParams columnParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    columnParams.leftMargin = Ui.dp(app, 10);
    row.addView(column, columnParams);

    String status;
    if (daily) {
      if (!inRange) {
        status = today.compareTo(start.isEmpty() ? today : start) < 0 ? "打卡未开始" : "打卡已结束";
      } else {
        status = checkedToday ? "今日已打卡" : "今日未打卡";
      }
    } else {
      status = done ? "已完成" : "进行中";
    }
    column.addView(Ui.text(app, status, 14, checked ? Ui.SUCCESS : Ui.TEXT, true));

    String created = Ui.formatIso(Ui.str(task, "createdAt"), "yyyy-MM-dd HH:mm");
    column.addView(Ui.text(app, "创建于 " + created, 11, Ui.MUTED, false));

    if (daily) {
      TextView badge = Ui.text(app, "每日打卡", 11, Ui.PRIMARY, true);
      badge.setBackground(Ui.rounded(app, Color.parseColor("#EEF2FF"), 0, 8));
      badge.setPadding(Ui.dp(app, 8), Ui.dp(app, 4), Ui.dp(app, 8), Ui.dp(app, 4));
      row.addView(badge);
    }

    if (!daily || inRange) {
      check.setOnClickListener(
          new View.OnClickListener() {
            @Override
            public void onClick(View view) {
              toggleStatus(daily);
            }
          });
    } else {
      check.setAlpha(0.35f);
    }
    return row;
  }

  private View buildTitleField() {
    EditText field = Ui.field(app, "任务标题", InputType.TYPE_CLASS_TEXT);
    field.setText(draftTitle);
    field.setTextSize(18);
    field.addTextChangedListener(
        new Watcher() {
          @Override
          public void onTextChanged(CharSequence value, int start, int before, int count) {
            draftTitle = value.toString();
          }
        });
    return field;
  }

  private View buildProjectSpinner() {
    final String[] names = new String[projects.length() + 1];
    names[0] = "未分类";
    int selection = 0;
    for (int i = 0; i < projects.length(); i++) {
      JSONObject project = Ui.item(projects, i);
      names[i + 1] = Ui.str(project, "name");
      if (Ui.longValue(project, "id", 0) == draftProjectId) selection = i + 1;
    }
    Spinner spinner = new Spinner(app);
    ArrayAdapter<String> adapter =
        new ArrayAdapter<>(app, android.R.layout.simple_spinner_item, names);
    adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
    spinner.setAdapter(adapter);
    spinner.setSelection(selection);
    spinner.setOnItemSelectedListener(
        new AdapterView.OnItemSelectedListener() {
          @Override
          public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
            draftProjectId = position == 0 ? 0 : Ui.longValue(Ui.item(projects, position - 1), "id", 0);
          }

          @Override
          public void onNothingSelected(AdapterView<?> parent) {}
        });
    return spinner;
  }

  private View buildPriorityChips() {
    final LinearLayout row = Ui.row(app);
    final TextView[] chips = new TextView[PRIORITY_LABELS.length];
    for (int i = 0; i < PRIORITY_LABELS.length; i++) {
      final int value = i;
      TextView chip = Ui.text(app, PRIORITY_LABELS[i], 13, Ui.MUTED, i == draftPriority);
      chip.setGravity(Gravity.CENTER);
      chip.setPadding(Ui.dp(app, 8), Ui.dp(app, 9), Ui.dp(app, 8), Ui.dp(app, 9));
      chip.setClickable(true);
      chip.setFocusable(true);
      stylePriorityChip(chip, value, value == draftPriority);
      chip.setOnClickListener(
          new View.OnClickListener() {
            @Override
            public void onClick(View view) {
              draftPriority = value;
              for (int j = 0; j < chips.length; j++) {
                stylePriorityChip(chips[j], j, j == draftPriority);
              }
            }
          });
      chips[i] = chip;
      LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
      if (i > 0) params.leftMargin = Ui.dp(app, 6);
      row.addView(chip, params);
    }
    return row;
  }

  private void stylePriorityChip(TextView chip, int value, boolean selected) {
    int color = Ui.priorityColor(value);
    chip.setTextColor(selected ? Color.WHITE : color);
    chip.setBackground(Ui.rounded(app, selected ? color : Ui.CARD, selected ? 0 : Ui.BORDER, 10));
    chip.setTypeface(Typeface.DEFAULT, selected ? Typeface.BOLD : Typeface.NORMAL);
  }

  private View buildEstimateField() {
    EditText field = Ui.field(app, "未设置", InputType.TYPE_CLASS_NUMBER);
    field.setText(draftEstimate);
    field.addTextChangedListener(
        new Watcher() {
          @Override
          public void onTextChanged(CharSequence value, int start, int before, int count) {
            draftEstimate = value.toString();
          }
        });
    return field;
  }

  private View buildDateRow(boolean daily) {
    LinearLayout row = Ui.row(app);
    final TextView startView = Ui.dateField(app, "开始日期");
    final TextView dueView = Ui.dateField(app, daily ? "结束日期" : "截止日期");

    if (!draftStart.isEmpty()) {
      startView.setText(draftStart);
      startView.setTextColor(Ui.TEXT);
    }
    if (!draftDue.isEmpty()) {
      dueView.setText(draftDue);
      dueView.setTextColor(Ui.TEXT);
    }

    startView.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            Ui.pickDate(
                app,
                draftStart,
                new Ui.DateCallback() {
                  @Override
                  public void onDate(String value) {
                    draftStart = value;
                    startView.setText(value);
                    startView.setTextColor(Ui.TEXT);
                  }
                });
          }
        });
    startView.setOnLongClickListener(
        new View.OnLongClickListener() {
          @Override
          public boolean onLongClick(View view) {
            draftStart = "";
            startView.setText("开始日期");
            startView.setTextColor(Ui.MUTED);
            return true;
          }
        });

    dueView.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            Ui.pickDate(
                app,
                draftDue,
                new Ui.DateCallback() {
                  @Override
                  public void onDate(String value) {
                    draftDue = value;
                    dueView.setText(value);
                    dueView.setTextColor(Ui.TEXT);
                  }
                });
          }
        });
    dueView.setOnLongClickListener(
        new View.OnLongClickListener() {
          @Override
          public boolean onLongClick(View view) {
            draftDue = "";
            dueView.setText("截止日期");
            dueView.setTextColor(Ui.MUTED);
            return true;
          }
        });

    row.addView(startView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    LinearLayout.LayoutParams dueParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    dueParams.leftMargin = Ui.dp(app, 8);
    row.addView(dueView, dueParams);
    return row;
  }

  private View buildNotesField() {
    EditText area = Ui.area(app, "补充说明、参考链接，或者完成任务的标准…", 4);
    area.setText(draftNotes);
    area.addTextChangedListener(
        new Watcher() {
          @Override
          public void onTextChanged(CharSequence value, int start, int before, int count) {
            draftNotes = value.toString();
          }
        });
    return area;
  }

  // ---------- 打卡日历 ----------

  private View buildCalendar() {
    LinearLayout wrap = Ui.column(app);
    String start = Ui.str(task, "startDate");
    if (start.isEmpty()) {
      String created = Ui.str(task, "createdAt");
      start = created.length() >= 10 ? created.substring(0, 10) : Ui.today();
    }
    String end = Ui.str(task, "dueDate");
    if (end.isEmpty()) end = Ui.today();
    if (start.compareTo(end) > 0) {
      wrap.addView(Ui.text(app, "设置开始和结束日期后，这里会显示打卡日历。", 12, Ui.MUTED, false));
      return wrap;
    }

    int startYear;
    int startMonth;
    int endYear;
    int endMonth;
    try {
      startYear = Integer.parseInt(start.substring(0, 4));
      startMonth = Integer.parseInt(start.substring(5, 7));
      endYear = Integer.parseInt(end.substring(0, 4));
      endMonth = Integer.parseInt(end.substring(5, 7));
    } catch (Exception error) {
      wrap.addView(Ui.text(app, "日期格式异常，无法显示打卡日历。", 12, Ui.MUTED, false));
      return wrap;
    }

    String today = Ui.today();
    int year = startYear;
    int month = startMonth;
    int guard = 0;
    while ((year < endYear || (year == endYear && month <= endMonth)) && guard < 24) {
      wrap.addView(buildMonth(year, month, start, end, today), block(10));
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      guard += 1;
    }
    return wrap;
  }

  private View buildMonth(int year, int month, String start, String end, String today) {
    LinearLayout box = Ui.column(app);
    box.addView(Ui.text(app, year + " 年 " + month + " 月", 13, Ui.TEXT, true));

    LinearLayout header = Ui.row(app);
    for (String label : WEEKDAYS) {
      TextView cell = Ui.text(app, label, 10, Ui.MUTED, false);
      cell.setGravity(Gravity.CENTER);
      header.addView(cell, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    }
    box.addView(header, block(6));

    Calendar calendar = Calendar.getInstance();
    calendar.set(year, month - 1, 1);
    int leading = (calendar.get(Calendar.DAY_OF_WEEK) + 5) % 7;
    int daysInMonth = calendar.getActualMaximum(Calendar.DAY_OF_MONTH);

    LinearLayout grid = Ui.column(app);
    LinearLayout week = Ui.row(app);
    int index = 0;
    for (; index < leading; index++) {
      week.addView(emptyCell(), cellParams(index));
    }
    for (int day = 1; day <= daysInMonth; day++) {
      String date = String.format(Locale.US, "%04d-%02d-%02d", year, month, day);
      week.addView(buildDayCell(day, date, start, end, today), cellParams(index));
      index += 1;
      if (index % 7 == 0) {
        grid.addView(week, block(2));
        week = Ui.row(app);
      }
    }
    if (week.getChildCount() > 0) {
      grid.addView(week, block(2));
    }
    box.addView(grid, block(4));
    return box;
  }

  private LinearLayout.LayoutParams cellParams(int index) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(0, Ui.dp(app, 30), 1f);
    int margin = Ui.dp(app, 1);
    params.setMargins(margin, margin, margin, margin);
    return params;
  }

  private View emptyCell() {
    TextView cell = new TextView(app);
    cell.setText("");
    return cell;
  }

  private View buildDayCell(int day, String date, String start, String end, String today) {
    boolean inRange = date.compareTo(start) >= 0 && date.compareTo(end) <= 0;
    TextView cell = new TextView(app);
    cell.setGravity(Gravity.CENTER);
    cell.setTextSize(11);
    if (!inRange) {
      cell.setText("");
      return cell;
    }
    cell.setText(String.valueOf(day));
    if (containsDate(date)) {
      cell.setBackground(Ui.rounded(app, Ui.SUCCESS, 0, 8));
      cell.setTextColor(Color.WHITE);
      cell.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    } else if (date.compareTo(today) < 0) {
      cell.setBackground(Ui.rounded(app, Color.parseColor("#FDECEC"), 0, 8));
      cell.setTextColor(Ui.DANGER);
    } else if (date.equals(today)) {
      cell.setBackground(Ui.rounded(app, Ui.CARD, Ui.PRIMARY, 8));
      cell.setTextColor(Ui.PRIMARY);
      cell.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    } else {
      cell.setBackground(Ui.rounded(app, Color.parseColor("#F3F4F6"), 0, 8));
      cell.setTextColor(Ui.MUTED);
    }
    return cell;
  }

  // ---------- 子任务 ----------

  private View buildSubtasksSection() {
    LinearLayout section = Ui.card(app);
    LinearLayout header = Ui.row(app);
    header.addView(
        Ui.sectionTitle(app, "子任务"),
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    int doneCount = 0;
    for (int i = 0; i < subtasks.length(); i++) {
      if (Ui.bool(Ui.item(subtasks, i), "done")) doneCount += 1;
    }
    header.addView(
        Ui.text(app, doneCount + "/" + subtasks.length(), 12, Ui.MUTED, false),
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    section.addView(header);

    if (subtasks.length() == 0) {
      section.addView(Ui.text(app, "还没有子任务，可以把任务拆小一点。", 12, Ui.MUTED, false), block(8));
    } else {
      for (int i = 0; i < subtasks.length(); i++) {
        section.addView(buildSubtaskRow(Ui.item(subtasks, i)), block(8));
      }
    }

    LinearLayout addRow = Ui.row(app);
    final EditText addField = Ui.field(app, "添加子任务，按回车确认", InputType.TYPE_CLASS_TEXT);
    addRow.addView(addField, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    TextView addButton = Ui.button(app, "添加", false);
    LinearLayout.LayoutParams addParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    addParams.leftMargin = Ui.dp(app, 8);
    addRow.addView(addButton, addParams);
    section.addView(addRow, block(10));

    addButton.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            addSubtask(addField);
          }
        });
    addField.setOnEditorActionListener(
        new TextView.OnEditorActionListener() {
          @Override
          public boolean onEditorAction(TextView view, int actionId, android.view.KeyEvent event) {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE
                || actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEND) {
              addSubtask(addField);
              return true;
            }
            return false;
          }
        });
    return section;
  }

  private View buildSubtaskRow(final JSONObject subtask) {
    final long subtaskId = Ui.longValue(subtask, "id", 0);
    final boolean done = Ui.bool(subtask, "done");
    final String savedTitle = Ui.str(subtask, "title");

    LinearLayout row = Ui.row(app);

    final CheckBox box = new CheckBox(app);
    box.setChecked(done);
    box.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            updateSubtaskValue(subtaskId, "done", box.isChecked());
          }
        });
    row.addView(box, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    final EditText titleField = Ui.field(app, "子任务内容", InputType.TYPE_CLASS_TEXT);
    titleField.setText(savedTitle);
    if (done) {
      titleField.setTextColor(Ui.MUTED);
      titleField.setPaintFlags(titleField.getPaintFlags() | Paint.STRIKE_THRU_TEXT_FLAG);
    }
    row.addView(titleField, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

    final TextView save = action("保存", Ui.PRIMARY);
    save.setEnabled(false);
    save.setAlpha(0.35f);
    row.addView(save, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    TextView delete = action("×", Ui.DANGER);
    row.addView(delete, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    titleField.addTextChangedListener(
        new Watcher() {
          @Override
          public void onTextChanged(CharSequence value, int start, int before, int count) {
            boolean changed = !value.toString().equals(savedTitle);
            save.setEnabled(changed);
            save.setAlpha(changed ? 1f : 0.35f);
          }
        });
    save.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            String title = titleField.getText().toString().trim();
            if (title.isEmpty()) {
              Ui.toast(app, "子任务内容不能为空");
              return;
            }
            updateSubtaskValue(subtaskId, "title", title);
          }
        });
    delete.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            deleteSubtask(subtaskId);
          }
        });
    return row;
  }

  // ---------- 时间记录 ----------

  private View buildTimeSection() {
    LinearLayout section = Ui.card(app);

    int focusSeconds = 0;
    for (int i = 0; i < sessions.length(); i++) {
      JSONObject session = Ui.item(sessions, i);
      if ("focus".equals(Ui.str(session, "mode")) && Ui.bool(session, "completed")) {
        focusSeconds += Ui.intValue(session, "durationSeconds", 0);
      }
    }
    int manualMinutes = 0;
    for (int i = 0; i < timeEntries.length(); i++) {
      manualMinutes += Ui.intValue(Ui.item(timeEntries, i), "minutes", 0);
    }
    int totalMinutes = Math.round(focusSeconds / 60f) + manualMinutes;

    LinearLayout header = Ui.row(app);
    header.addView(
        Ui.sectionTitle(app, "时间记录"),
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    header.addView(
        Ui.text(app, "共 " + Ui.minutesText(totalMinutes), 12, Ui.MUTED, false),
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    section.addView(header);

    LinearLayout summary = Ui.row(app);
    TextView focusView = Ui.text(app, "番茄专注 " + Ui.minutesText(Math.round(focusSeconds / 60f)), 12, Ui.MUTED, false);
    TextView manualView = Ui.text(app, "手动记录 " + Ui.minutesText(manualMinutes), 12, Ui.MUTED, false);
    summary.addView(focusView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    summary.addView(manualView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    section.addView(summary, block(8));

    LinearLayout addRow = Ui.row(app);
    final EditText minutesField = Ui.field(app, "分钟", InputType.TYPE_CLASS_NUMBER);
    final EditText noteField = Ui.field(app, "备注（可选）", InputType.TYPE_CLASS_TEXT);
    addRow.addView(minutesField, new LinearLayout.LayoutParams(Ui.dp(app, 72), ViewGroup.LayoutParams.WRAP_CONTENT));
    LinearLayout.LayoutParams noteParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    noteParams.leftMargin = Ui.dp(app, 8);
    addRow.addView(noteField, noteParams);
    TextView addButton = Ui.button(app, "记录", false);
    LinearLayout.LayoutParams addParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    addParams.leftMargin = Ui.dp(app, 8);
    addRow.addView(addButton, addParams);
    section.addView(addRow, block(10));
    addButton.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            addTime(minutesField, noteField);
          }
        });

    if (timeEntries.length() == 0 && sessions.length() == 0) {
      section.addView(
          Ui.text(app, "完成番茄钟或手动记录后，时间会出现在这里。", 12, Ui.MUTED, false), block(10));
      return section;
    }

    for (int i = 0; i < timeEntries.length(); i++) {
      section.addView(buildTimeEntryRow(Ui.item(timeEntries, i)), block(8));
    }
    int limit = Math.min(8, sessions.length());
    for (int i = 0; i < limit; i++) {
      section.addView(buildSessionRow(Ui.item(sessions, i)), block(8));
    }
    return section;
  }

  private View buildTimeEntryRow(JSONObject entry) {
    final long entryId = Ui.longValue(entry, "id", 0);
    LinearLayout row = Ui.row(app);
    String note = Ui.str(entry, "note");
    String text = Ui.intValue(entry, "minutes", 0) + " 分钟" + (note.isEmpty() ? "" : " · " + note);
    row.addView(Ui.text(app, text, 13, Ui.TEXT, false), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    row.addView(Ui.text(app, Ui.formatIso(Ui.str(entry, "createdAt"), "MM-dd HH:mm"), 11, Ui.MUTED, false));
    TextView delete = action("删除", Ui.DANGER);
    delete.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            deleteTime(entryId);
          }
        });
    row.addView(delete);
    return row;
  }

  private View buildSessionRow(JSONObject session) {
    LinearLayout row = Ui.row(app);
    String mode = Ui.str(session, "mode");
    String label = "focus".equals(mode) ? "番茄专注" : "short".equals(mode) ? "短休息" : "长休息";
    int color = "focus".equals(mode) ? Ui.PRIMARY : "short".equals(mode) ? Ui.SUCCESS : Ui.SKY;
    int minutes = Math.round(Ui.intValue(session, "durationSeconds", 0) / 60f);
    row.addView(
        Ui.text(app, label + " " + minutes + " 分钟", 13, color, false),
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    row.addView(Ui.text(app, Ui.formatIso(Ui.str(session, "endedAt"), "MM-dd HH:mm"), 11, Ui.MUTED, false));
    return row;
  }

  private View buildDeleteButton() {
    TextView delete = Ui.text(app, "删除任务", 14, Ui.DANGER, true);
    delete.setGravity(Gravity.CENTER);
    delete.setBackground(
        Ui.rounded(app, Color.parseColor("#FEF2F2"), Color.parseColor("#FECACA"), 12));
    delete.setPadding(0, Ui.dp(app, 12), 0, Ui.dp(app, 12));
    delete.setClickable(true);
    delete.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            confirmDeleteTask();
          }
        });
    return delete;
  }

  // ---------- 操作 ----------

  private void toggleStatus(final boolean daily) {
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.toggleTask(taskId, daily ? Ui.today() : null);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            load();
            onChanged.run();
          }

          @Override
          public void onError(Exception error) {
            handleError(error);
          }
        });
  }

  private void addSubtask(final EditText input) {
    final String title = input.getText().toString().trim();
    if (title.isEmpty()) {
      Ui.toast(app, "子任务内容不能为空");
      return;
    }
    input.setText("");
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.createSubtask(taskId, title);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            load();
            onChanged.run();
          }

          @Override
          public void onError(Exception error) {
            handleError(error);
          }
        });
  }

  private void updateSubtaskValue(long subtaskId, String key, Object value) {
    JSONObject body = new JSONObject();
    try {
      body.put(key, value);
    } catch (Exception ignored) {
      // JSONObject 写入不会失败
    }
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.updateSubtask(subtaskId, body);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject result) {
            load();
            onChanged.run();
          }

          @Override
          public void onError(Exception error) {
            handleError(error);
          }
        });
  }

  private void deleteSubtask(long subtaskId) {
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.deleteSubtask(subtaskId);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            load();
            onChanged.run();
          }

          @Override
          public void onError(Exception error) {
            handleError(error);
          }
        });
  }

  private void addTime(EditText minutesField, EditText noteField) {
    String raw = minutesField.getText().toString().trim();
    int minutes = 0;
    try {
      minutes = Integer.parseInt(raw);
    } catch (Exception ignored) {
      minutes = 0;
    }
    if (minutes <= 0 || minutes > 1440) {
      Ui.toast(app, "请输入有效的分钟数（1-1440）");
      return;
    }
    final int value = minutes;
    final String note = noteField.getText().toString().trim();
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.addTime(taskId, value, note);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject result) {
            Ui.toast(app, "时间已记录");
            load();
            onChanged.run();
          }

          @Override
          public void onError(Exception error) {
            handleError(error);
          }
        });
  }

  private void deleteTime(long entryId) {
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.deleteTime(entryId);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            load();
            onChanged.run();
          }

          @Override
          public void onError(Exception error) {
            handleError(error);
          }
        });
  }

  private void saveTask() {
    final boolean daily = "daily".equals(Ui.str(task, "taskType"));
    final String title = draftTitle.trim();
    if (title.isEmpty()) {
      Ui.toast(app, "任务标题不能为空");
      return;
    }
    if (daily && draftDue.isEmpty()) {
      Ui.toast(app, "每日打卡任务需要设置结束日期");
      return;
    }
    if (!draftStart.isEmpty() && !draftDue.isEmpty() && draftStart.compareTo(draftDue) > 0) {
      Ui.toast(app, "开始日期不能晚于截止日期");
      return;
    }
    int estimate = 0;
    String rawEstimate = draftEstimate.trim();
    if (!rawEstimate.isEmpty()) {
      try {
        estimate = Integer.parseInt(rawEstimate);
      } catch (Exception error) {
        Ui.toast(app, "预计时长需要填写数字");
        return;
      }
    }
    final int estimateValue = Math.max(0, estimate);

    JSONObject body = new JSONObject();
    try {
      body.put("title", title);
      body.put("notes", draftNotes);
      body.put("priority", draftPriority);
      body.put("estimateMinutes", estimateValue);
      body.put("startDate", draftStart.isEmpty() ? JSONObject.NULL : draftStart);
      body.put("dueDate", draftDue.isEmpty() ? JSONObject.NULL : draftDue);
      body.put("projectId", draftProjectId > 0 ? draftProjectId : JSONObject.NULL);
    } catch (Exception ignored) {
      // JSONObject 写入不会失败
    }

    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.updateTask(taskId, body);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            Ui.toast(app, "任务已保存");
            load();
            onChanged.run();
          }

          @Override
          public void onError(Exception error) {
            handleError(error);
          }
        });
  }

  private void confirmDeleteTask() {
    new AlertDialog.Builder(app)
        .setTitle("删除任务")
        .setMessage("删除后无法恢复，相关的子任务、时间记录和专注记录关联也会被清除。")
        .setPositiveButton(
            "删除任务",
            new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface dialogInterface, int which) {
                Async.run(
                    new Async.Work<JSONObject>() {
                      @Override
                      public JSONObject run() throws Exception {
                        return api.deleteTask(taskId);
                      }
                    },
                    new Async.Done<JSONObject>() {
                      @Override
                      public void onSuccess(JSONObject value) {
                        Ui.toast(app, "任务已删除");
                        if (dialog != null) dialog.dismiss();
                      }

                      @Override
                      public void onError(Exception error) {
                        handleError(error);
                      }
                    });
              }
            })
        .setNegativeButton("取消", null)
        .show();
  }

  // ---------- 工具 ----------

  private void addLabel(String text) {
    TextView view = Ui.label(app, text);
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.topMargin = Ui.dp(app, 14);
    body.addView(view, params);
  }

  private LinearLayout.LayoutParams block(int topMarginDp) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.topMargin = Ui.dp(app, topMarginDp);
    return params;
  }

  private TextView action(String label, int color) {
    TextView view = Ui.text(app, label, 12, color, true);
    view.setPadding(Ui.dp(app, 10), Ui.dp(app, 8), Ui.dp(app, 6), Ui.dp(app, 8));
    view.setClickable(true);
    return view;
  }

  private boolean containsDate(String date) {
    for (String value : checkins) {
      if (date.equals(value)) return true;
    }
    return false;
  }

  private static boolean isInRange(String date, String start, String due) {
    if (start != null && !start.isEmpty() && date.compareTo(start) < 0) return false;
    if (due != null && !due.isEmpty() && date.compareTo(due) > 0) return false;
    return true;
  }

  private void handleError(Exception error) {
    if (error instanceof ApiException && ((ApiException) error).isUnauthorized()) {
      // 先关掉覆盖层，否则登录页会被详情对话框挡住。
      if (dialog != null) dialog.dismiss();
      app.sessionExpired();
      return;
    }
    String message = error == null ? null : error.getMessage();
    Ui.toast(app, message == null || message.isEmpty() ? "操作失败" : message);
  }

  private abstract static class Watcher implements TextWatcher {
    @Override
    public void beforeTextChanged(CharSequence value, int start, int count, int after) {}

    @Override
    public void afterTextChanged(Editable value) {}
  }
}
