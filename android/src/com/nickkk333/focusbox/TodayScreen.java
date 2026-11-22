package com.nickkk333.focusbox;

import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** 今日工作台：今日专注概览、快速添加、今日任务与最近备忘。 */
public class TodayScreen extends BaseScreen {
  private final LinearLayout statsRow;
  private final LinearLayout taskList;
  private final LinearLayout memoList;
  private final EditText quickAdd;
  private final TextView taskCount;
  private final TextView memoCount;

  private long loadToken;

  public TodayScreen(MainActivity app) {
    super(app);

    ScrollView scroll = new ScrollView(app);
    scroll.setFillViewport(true);

    LinearLayout column = Ui.column(app);
    int side = Ui.dp(app, 16);
    column.setPadding(side, side, side, Ui.dp(app, 24));
    scroll.addView(
        column,
        new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    LinearLayout overview = Ui.card(app);
    statsRow = Ui.row(app);
    overview.addView(statsRow, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    column.addView(overview, Ui.cardParams(app));

    LinearLayout quick = Ui.card(app);
    quick.addView(Ui.label(app, "快速添加今日任务"));
    LinearLayout quickRow = Ui.row(app);
    LinearLayout.LayoutParams quickRowParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    quickRowParams.topMargin = Ui.dp(app, 8);
    quick.addView(quickRow, quickRowParams);

    quickAdd = Ui.field(app, "今天要做点什么？", InputType.TYPE_CLASS_TEXT);
    quickRow.addView(quickAdd, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    TextView addButton = Ui.button(app, "添加", true);
    LinearLayout.LayoutParams addParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    addParams.leftMargin = Ui.dp(app, 8);
    quickRow.addView(addButton, addParams);
    addButton.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            submitQuickAdd();
          }
        });
    quickAdd.setOnEditorActionListener(
        new TextView.OnEditorActionListener() {
          @Override
          public boolean onEditorAction(TextView view, int actionId, android.view.KeyEvent event) {
            if (actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_SEND) {
              submitQuickAdd();
              return true;
            }
            return false;
          }
        });
    column.addView(quick, Ui.cardParams(app));

    column.addView(sectionHeader("今日任务", true), sectionParams());
    taskCount = (TextView) ((LinearLayout) column.getChildAt(column.getChildCount() - 1)).getChildAt(1);
    taskList = Ui.column(app);
    column.addView(taskList, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    column.addView(sectionHeader("最近备忘", false), sectionParams());
    memoCount = (TextView) ((LinearLayout) column.getChildAt(column.getChildCount() - 1)).getChildAt(1);
    memoList = Ui.column(app);
    column.addView(memoList, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
  }

  @Override
  public String title() {
    return "今日";
  }

  private LinearLayout.LayoutParams sectionParams() {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.topMargin = Ui.dp(app, 20);
    params.bottomMargin = Ui.dp(app, 8);
    return params;
  }

  private LinearLayout sectionHeader(String title, boolean withAction) {
    LinearLayout header = Ui.row(app);
    header.addView(Ui.sectionTitle(app, title), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    TextView count = Ui.text(app, "", 12, Ui.MUTED, false);
    header.addView(count, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    if (!withAction) {
      count.setClickable(true);
      count.setTextColor(Ui.PRIMARY);
      count.setOnClickListener(
          new View.OnClickListener() {
            @Override
            public void onClick(View view) {
              app.openMemos();
            }
          });
    }
    return header;
  }

  @Override
  public void refresh() {
    final long token = ++loadToken;
    final String date = Ui.today();
    final int tz = Ui.tzOffset();

    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.badges(date, tz);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            if (token != loadToken) return;
            renderStats(value);
          }

          @Override
          public void onError(Exception error) {
            if (token != loadToken) return;
            handleApiError(error);
          }
        });

    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.tasks("due=today&date=" + ApiClient.enc(date));
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            if (token != loadToken) return;
            renderTasks(Ui.array(value, "tasks"));
          }

          @Override
          public void onError(Exception error) {
            if (token != loadToken) return;
            handleApiError(error);
          }
        });

    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.memos("archived=0");
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            if (token != loadToken) return;
            renderMemos(Ui.array(value, "memos"));
          }

          @Override
          public void onError(Exception error) {
            if (token != loadToken) return;
            handleApiError(error);
          }
        });
  }

  private void renderStats(JSONObject badges) {
    int focusSeconds = Ui.intValue(badges, "focusTodaySeconds", 0);
    String focusText = Ui.durationText(focusSeconds);
    String todayText = String.valueOf(Ui.intValue(badges, "todayTasks", 0));
    String memoText = String.valueOf(Ui.intValue(badges, "memos", 0));

    statsRow.removeAllViews();
    statsRow.addView(statBlock("今日专注", focusText, Ui.PRIMARY), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    statsRow.addView(statBlock("今日待办", todayText, Ui.TEXT), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    statsRow.addView(statBlock("备忘总数", memoText, Ui.TEXT), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
  }

  private View statBlock(String label, String value, int color) {
    LinearLayout block = Ui.column(app);
    TextView valueView = Ui.text(app, value, 16, color, true);
    TextView labelView = Ui.text(app, label, 12, Ui.MUTED, false);
    LinearLayout.LayoutParams labelParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    labelParams.topMargin = Ui.dp(app, 2);
    block.addView(valueView);
    block.addView(labelView, labelParams);
    return block;
  }

  private void renderTasks(JSONArray tasks) {
    taskList.removeAllViews();
    taskCount.setText(tasks.length() + " 项");
    if (tasks.length() == 0) {
      taskList.addView(emptyText("今天没有待办任务，先加一条吧"));
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
      taskList.addView(row, params);
    }
  }

  private void renderMemos(JSONArray memos) {
    memoList.removeAllViews();
    memoCount.setText("查看全部 ›");
    if (memos.length() == 0) {
      memoList.addView(emptyText("还没有备忘，去备忘页随手记一条"));
      return;
    }
    int limit = Math.min(3, memos.length());
    for (int i = 0; i < limit; i++) {
      JSONObject memo = Ui.item(memos, i);
      LinearLayout card = Ui.card(app);
      String content = Ui.str(memo, "content");
      TextView contentView = Ui.text(app, content, 14, Ui.TEXT, false);
      contentView.setMaxLines(4);
      contentView.setEllipsize(TextUtils.TruncateAt.END);
      card.addView(contentView);

      String createdAt = Ui.formatIso(Ui.str(memo, "createdAt"), "MM-dd HH:mm");
      String tags = tagsText(memo);
      String footer = createdAt + (tags.isEmpty() ? "" : " · " + tags);
      TextView footerText = Ui.text(app, footer, 11, Ui.MUTED, false);
      LinearLayout.LayoutParams footerParams =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      footerParams.topMargin = Ui.dp(app, 6);
      card.addView(footerText, footerParams);

      card.setOnClickListener(
          new View.OnClickListener() {
            @Override
            public void onClick(View view) {
              app.openMemos();
            }
          });
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      params.topMargin = Ui.dp(app, i == 0 ? 0 : 8);
      memoList.addView(card, params);
    }
  }

  private String tagsText(JSONObject memo) {
    JSONArray tags = Ui.array(memo, "tags");
    if (tags.length() == 0) return "";
    StringBuilder builder = new StringBuilder();
    for (int i = 0; i < tags.length(); i++) {
      if (i > 0) builder.append(' ');
      builder.append('#').append(tags.optString(i));
    }
    return builder.toString();
  }

  private View emptyText(String message) {
    TextView view = Ui.text(app, message, 13, Ui.MUTED, false);
    view.setGravity(Gravity.CENTER);
    view.setPadding(0, Ui.dp(app, 18), 0, Ui.dp(app, 18));
    return view;
  }

  private void submitQuickAdd() {
    final String title = quickAdd.getText().toString().trim();
    if (title.isEmpty()) {
      toast("请输入任务标题");
      return;
    }
    JSONObject body = new JSONObject();
    try {
      body.put("title", title);
    } catch (Exception ignored) {
      // JSONObject 写入不会失败
    }
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.createTask(body);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            quickAdd.setText("");
            toast("任务已添加");
            refresh();
          }

          @Override
          public void onError(Exception error) {
            handleApiError(error);
          }
        });
  }
}
