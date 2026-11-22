package com.nickkk333.focusbox;

import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** 任务清单：按状态筛选、搜索、新建与快速操作。 */
public class TasksScreen extends BaseScreen {
  private static final String[] STATUS_VALUES = {"open", "done", "all"};
  private static final String[] STATUS_LABELS = {"进行中", "已完成", "全部"};

  private final LinearLayout list;
  private final LinearLayout filterRow;
  private final TextView[] chips = new TextView[STATUS_LABELS.length];
  private final EditText searchField;
  private final Handler handler = new Handler(Looper.getMainLooper());

  private String status = STATUS_VALUES[0];
  private String keyword = "";
  private long loadToken;

  private final Runnable searchRunnable =
      new Runnable() {
        @Override
        public void run() {
          keyword = searchField.getText().toString().trim();
          refresh();
        }
      };

  public TasksScreen(MainActivity app) {
    super(app);

    LinearLayout header = Ui.column(app);
    int side = Ui.dp(app, 16);
    header.setPadding(side, Ui.dp(app, 12), side, Ui.dp(app, 8));

    filterRow = Ui.row(app);
    for (int i = 0; i < STATUS_LABELS.length; i++) {
      final int index = i;
      TextView chip = Ui.chip(app, STATUS_LABELS[i], i == 0);
      chip.setOnClickListener(
          new View.OnClickListener() {
            @Override
            public void onClick(View view) {
              status = STATUS_VALUES[index];
              updateChips();
              refresh();
            }
          });
      chips[i] = chip;
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      if (i > 0) params.leftMargin = Ui.dp(app, 8);
      filterRow.addView(chip, params);
    }
    header.addView(filterRow);

    LinearLayout actionRow = Ui.row(app);
    LinearLayout.LayoutParams actionParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    actionParams.topMargin = Ui.dp(app, 10);
    header.addView(actionRow, actionParams);

    searchField = Ui.field(app, "搜索任务或备注", InputType.TYPE_CLASS_TEXT);
    actionRow.addView(searchField, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    TextView create = Ui.button(app, "新建", true);
    LinearLayout.LayoutParams createParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    createParams.leftMargin = Ui.dp(app, 8);
    actionRow.addView(create, createParams);
    create.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            TaskForm.showCreate(app, new Runnable() {
              @Override
              public void run() {
                refresh();
              }
            });
          }
        });

    searchField.addTextChangedListener(
        new TextWatcher() {
          @Override
          public void beforeTextChanged(CharSequence value, int start, int count, int after) {}

          @Override
          public void onTextChanged(CharSequence value, int start, int before, int count) {
            handler.removeCallbacks(searchRunnable);
            handler.postDelayed(searchRunnable, 400);
          }

          @Override
          public void afterTextChanged(Editable value) {}
        });

    addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    ScrollView scroll = new ScrollView(app);
    scroll.setFillViewport(true);
    list = Ui.column(app);
    list.setPadding(side, Ui.dp(app, 4), side, Ui.dp(app, 24));
    scroll.addView(
        list,
        new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
  }

  @Override
  public String title() {
    return "任务";
  }

  @Override
  public void dispose() {
    handler.removeCallbacks(searchRunnable);
  }

  private void updateChips() {
    for (int i = 0; i < chips.length; i++) {
      boolean selected = STATUS_VALUES[i].equals(status);
      chips[i].setTextColor(selected ? android.graphics.Color.WHITE : Ui.MUTED);
      chips[i].setBackground(Ui.rounded(app, selected ? Ui.PRIMARY : Ui.CARD, selected ? 0 : Ui.BORDER, 999));
      chips[i].setTypeface(null, selected ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
    }
  }

  @Override
  public void refresh() {
    final long token = ++loadToken;
    StringBuilder query = new StringBuilder();
    query.append("status=").append(status);
    query.append("&date=").append(ApiClient.enc(Ui.today()));
    if (!keyword.isEmpty()) query.append("&search=").append(ApiClient.enc(keyword));
    final String path = query.toString();

    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.tasks(path);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            if (token != loadToken) return;
            render(Ui.array(value, "tasks"));
          }

          @Override
          public void onError(Exception error) {
            if (token != loadToken) return;
            handleApiError(error);
          }
        });
  }

  private void render(JSONArray tasks) {
    list.removeAllViews();
    if (tasks.length() == 0) {
      TextView empty = Ui.text(app, "没有符合条件的任务", 13, Ui.MUTED, false);
      empty.setGravity(Gravity.CENTER);
      empty.setPadding(0, Ui.dp(app, 24), 0, Ui.dp(app, 24));
      list.addView(empty);
      return;
    }
    for (int i = 0; i < tasks.length(); i++) {
      View row = TaskRow.build(app, Ui.item(tasks, i), new Runnable() {
        @Override
        public void run() {
          refresh();
        }
      }, true);
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      params.topMargin = Ui.dp(app, i == 0 ? 0 : 8);
      list.addView(row, params);
    }
  }
}
