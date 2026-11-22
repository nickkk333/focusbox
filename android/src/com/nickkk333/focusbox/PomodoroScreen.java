package com.nickkk333.focusbox;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** 番茄钟：专注 / 短休息 / 长休息，完成后写入服务端记录。 */
public class PomodoroScreen extends BaseScreen {
  private static final String MODE_FOCUS = "focus";
  private static final String MODE_SHORT = "short";
  private static final String MODE_LONG = "long";
  private static final String[] MODES = {MODE_FOCUS, MODE_SHORT, MODE_LONG};
  private static final String[] MODE_LABELS = {"专注", "短休息", "长休息"};

  private static final int STATE_IDLE = 0;
  private static final int STATE_RUNNING = 1;
  private static final int STATE_PAUSED = 2;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private final TimerRing ring;
  private final TextView taskChip;
  private final TextView goalText;
  private final TextView countText;
  private final TextView startButton;
  private final TextView finishButton;
  private final TextView[] modeChips = new TextView[MODES.length];

  private JSONObject settings = new JSONObject();
  private JSONObject task;
  private String mode = MODE_FOCUS;
  private int state = STATE_IDLE;
  private long totalMillis = 25 * 60 * 1000L;
  private long remainingMillis = 25 * 60 * 1000L;
  private long endAt;
  private String startedAt;
  private int completedFocus;

  private final Runnable tick =
      new Runnable() {
        @Override
        public void run() {
          if (state != STATE_RUNNING) return;
          long left = endAt - SystemClock.elapsedRealtime();
          if (left <= 0) {
            complete(true);
            return;
          }
          remainingMillis = left;
          updateRing();
          handler.postDelayed(this, 200);
        }
      };

  public PomodoroScreen(MainActivity app) {
    super(app);
    ring = new TimerRing(app);
    taskChip = Ui.text(app, "未关联任务", 13, Ui.MUTED, false);
    goalText = Ui.text(app, "", 13, Ui.MUTED, false);
    countText = Ui.text(app, "", 12, Ui.MUTED, false);
    startButton = Ui.button(app, "开始专注", true);
    finishButton = Ui.button(app, "结束并记录", false);
    build();
    resetTimer();
    refresh();
  }

  private void build() {
    ScrollView scroll = new ScrollView(app);
    scroll.setFillViewport(true);
    LinearLayout column = Ui.column(app);
    int side = Ui.dp(app, 16);
    column.setPadding(side, side, side, Ui.dp(app, 24));
    scroll.addView(
        column,
        new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    LinearLayout taskCard = Ui.card(app);
    LinearLayout taskRow = Ui.row(app);
    taskRow.addView(taskChip, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    TextView pick = action("选择", Ui.PRIMARY);
    TextView clear = action("清除", Ui.MUTED);
    taskRow.addView(pick);
    taskRow.addView(clear);
    taskCard.addView(taskRow);
    pick.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            pickTask();
          }
        });
    clear.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            clearTask();
          }
        });
    column.addView(taskCard, Ui.cardParams(app));

    LinearLayout modesRow = Ui.row(app);
    modesRow.setGravity(Gravity.CENTER_HORIZONTAL);
    LinearLayout.LayoutParams modesParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    modesParams.topMargin = Ui.dp(app, 16);
    column.addView(modesRow, modesParams);
    for (int i = 0; i < MODES.length; i++) {
      final int index = i;
      TextView chip = Ui.chip(app, MODE_LABELS[i], i == 0);
      chip.setOnClickListener(
          new View.OnClickListener() {
            @Override
            public void onClick(View view) {
              setMode(MODES[index]);
            }
          });
      modeChips[i] = chip;
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      if (i > 0) params.leftMargin = Ui.dp(app, 8);
      modesRow.addView(chip, params);
    }

    int ringSize = Ui.dp(app, 220);
    LinearLayout ringBox = Ui.column(app);
    ringBox.setGravity(Gravity.CENTER_HORIZONTAL);
    LinearLayout.LayoutParams ringParams = new LinearLayout.LayoutParams(ringSize, ringSize);
    ringParams.topMargin = Ui.dp(app, 18);
    ringBox.addView(ring, ringParams);
    column.addView(ringBox, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    goalText.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams goalParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    goalParams.topMargin = Ui.dp(app, 12);
    column.addView(goalText, goalParams);

    countText.setGravity(Gravity.CENTER);
    LinearLayout.LayoutParams countParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    countParams.topMargin = Ui.dp(app, 4);
    column.addView(countText, countParams);

    LinearLayout.LayoutParams startParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    startParams.topMargin = Ui.dp(app, 18);
    column.addView(startButton, startParams);
    startButton.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            startOrPause();
          }
        });

    LinearLayout actions = Ui.row(app);
    LinearLayout.LayoutParams actionsParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    actionsParams.topMargin = Ui.dp(app, 10);
    column.addView(actions, actionsParams);

    TextView reset = Ui.button(app, "重置", false);
    actions.addView(reset, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    LinearLayout.LayoutParams finishParams =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    finishParams.leftMargin = Ui.dp(app, 10);
    actions.addView(finishButton, finishParams);
    reset.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            resetTimer();
          }
        });
    finishButton.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            confirmFinish();
          }
        });

    addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
  }

  @Override
  public String title() {
    return "番茄";
  }

  private TextView action(String label, int color) {
    TextView view = Ui.text(app, label, 12, color, true);
    view.setPadding(Ui.dp(app, 10), Ui.dp(app, 6), Ui.dp(app, 4), Ui.dp(app, 6));
    return view;
  }

  @Override
  public void dispose() {
    handler.removeCallbacks(tick);
  }

  public void attachTask(JSONObject value) {
    task = value;
    String title = Ui.str(value, "title");
    taskChip.setText(title.isEmpty() ? "已关联任务" : "关联任务：" + title);
    taskChip.setTextColor(Ui.PRIMARY);
    if (state == STATE_IDLE) {
      mode = MODE_FOCUS;
      resetTimer();
    }
  }

  private void clearTask() {
    task = null;
    taskChip.setText("未关联任务");
    taskChip.setTextColor(Ui.MUTED);
    if (state == STATE_IDLE && MODE_FOCUS.equals(mode)) {
      resetTimer();
    }
  }

  private void pickTask() {
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.tasks("due=today&date=" + ApiClient.enc(Ui.today()));
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            final JSONArray tasks = Ui.array(value, "tasks");
            final String[] names = new String[tasks.length() + 1];
            names[0] = "不关联任务";
            for (int i = 0; i < tasks.length(); i++) {
              String title = Ui.str(Ui.item(tasks, i), "title");
              names[i + 1] = title.isEmpty() ? "未命名任务" : title;
            }
            new AlertDialog.Builder(app)
                .setTitle("选择今日任务")
                .setItems(
                    names,
                    new DialogInterface.OnClickListener() {
                      @Override
                      public void onClick(DialogInterface dialog, int which) {
                        if (which == 0) {
                          clearTask();
                        } else {
                          attachTask(Ui.item(tasks, which - 1));
                        }
                      }
                    })
                .show();
          }

          @Override
          public void onError(Exception error) {
            handleApiError(error);
          }
        });
  }

  @Override
  public void refresh() {
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.settings();
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            settings = Ui.object(value, "settings");
            if (state == STATE_IDLE) resetTimer();
          }

          @Override
          public void onError(Exception error) {
            handleApiError(error);
          }
        });

    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.badges(Ui.today(), Ui.tzOffset());
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            int todayMinutes = Math.round(Ui.intValue(value, "focusTodaySeconds", 0) / 60f);
            int goal = Math.max(1, settings.optInt("dailyGoalMinutes", 120));
            goalText.setText("今日专注 " + todayMinutes + " 分钟 · 目标 " + goal + " 分钟");
          }

          @Override
          public void onError(Exception error) {
            handleApiError(error);
          }
        });

    updateCount();
  }

  private void updateCount() {
    countText.setText(completedFocus > 0 ? "本次已完成 " + completedFocus + " 个番茄" : "完成后会自动记录到统计");
  }

  private int durationMinutes() {
    if (MODE_SHORT.equals(mode)) {
      return clamp(settings.optInt("shortBreakMinutes", 5), 1, 60);
    }
    if (MODE_LONG.equals(mode)) {
      return clamp(settings.optInt("longBreakMinutes", 15), 1, 120);
    }
    return clamp(settings.optInt("focusMinutes", 25), 1, 180);
  }

  private static int clamp(int value, int min, int max) {
    return Math.min(max, Math.max(min, value));
  }

  private void setMode(String value) {
    mode = value;
    resetTimer();
  }

  private void resetTimer() {
    handler.removeCallbacks(tick);
    state = STATE_IDLE;
    totalMillis = durationMinutes() * 60000L;
    remainingMillis = totalMillis;
    startedAt = null;
    updateModeChips();
    updateAccent();
    updateRing();
    updateButtons();
  }

  private void updateModeChips() {
    for (int i = 0; i < modeChips.length; i++) {
      boolean selected = MODES[i].equals(mode);
      TextView chip = modeChips[i];
      chip.setTextColor(selected ? android.graphics.Color.WHITE : Ui.MUTED);
      chip.setBackground(Ui.rounded(app, selected ? accentColor() : Ui.CARD, selected ? 0 : Ui.BORDER, 999));
      chip.setTypeface(null, selected ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
    }
  }

  private int accentColor() {
    if (MODE_SHORT.equals(mode)) return Ui.SUCCESS;
    if (MODE_LONG.equals(mode)) return Ui.SKY;
    return Ui.PRIMARY;
  }

  private void updateAccent() {
    int accent = accentColor();
    ring.setAccent(accent);
    startButton.setBackground(Ui.rounded(app, accent, 0, 12));
  }

  private void updateRing() {
    float progress = totalMillis <= 0 ? 0f : remainingMillis / (float) totalMillis;
    ring.setProgress(progress);
    ring.setTime(Ui.formatClock(remainingMillis));
    ring.setSubtitle(MODE_LABELS[modeIndex()]);
  }

  private int modeIndex() {
    for (int i = 0; i < MODES.length; i++) {
      if (MODES[i].equals(mode)) return i;
    }
    return 0;
  }

  private void updateButtons() {
    if (state == STATE_RUNNING) {
      startButton.setText("暂停");
    } else if (state == STATE_PAUSED) {
      startButton.setText("继续");
    } else {
      startButton.setText(MODE_FOCUS.equals(mode) ? "开始专注" : "开始休息");
    }
    boolean active = state != STATE_IDLE;
    finishButton.setEnabled(active);
    finishButton.setAlpha(active ? 1f : 0.45f);
  }

  private void startOrPause() {
    if (state == STATE_RUNNING) {
      pauseTimer();
      return;
    }
    if (state == STATE_IDLE) {
      totalMillis = durationMinutes() * 60000L;
      remainingMillis = totalMillis;
      startedAt = Ui.nowIso();
    }
    if (remainingMillis <= 0) remainingMillis = totalMillis;
    endAt = SystemClock.elapsedRealtime() + remainingMillis;
    state = STATE_RUNNING;
    updateButtons();
    handler.removeCallbacks(tick);
    handler.post(tick);
  }

  private void pauseTimer() {
    remainingMillis = Math.max(0, endAt - SystemClock.elapsedRealtime());
    state = STATE_PAUSED;
    handler.removeCallbacks(tick);
    updateRing();
    updateButtons();
  }

  private void confirmFinish() {
    if (state == STATE_IDLE) {
      toast("当前没有进行中的计时");
      return;
    }
    new AlertDialog.Builder(app)
        .setTitle("结束计时")
        .setMessage("结束并记录当前时长？")
        .setPositiveButton(
            "结束",
            new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface dialog, int which) {
                complete(false);
              }
            })
        .setNegativeButton("继续专注", null)
        .show();
  }

  private void complete(boolean natural) {
    int plannedSeconds = (int) (totalMillis / 1000);
    long left =
        state == STATE_RUNNING
            ? Math.max(0, endAt - SystemClock.elapsedRealtime())
            : remainingMillis;
    int elapsed = natural ? plannedSeconds : (int) ((totalMillis - left) / 1000);
    String finishedMode = mode;

    handler.removeCallbacks(tick);
    state = STATE_IDLE;
    remainingMillis = totalMillis;
    updateRing();
    updateButtons();

    if (elapsed >= 1) {
      recordSession(finishedMode, elapsed, natural);
    }

    if (natural && MODE_FOCUS.equals(finishedMode)) {
      completedFocus++;
      updateCount();
      if (settings.optBoolean("autoStartBreaks", false)) {
        int interval = Math.max(2, settings.optInt("longBreakInterval", 4));
        setMode(completedFocus % interval == 0 ? MODE_LONG : MODE_SHORT);
        startOrPause();
      }
    } else if (natural && settings.optBoolean("autoStartFocus", false)) {
      setMode(MODE_FOCUS);
      startOrPause();
    }
  }

  private void recordSession(String finishedMode, int seconds, boolean completed) {
    JSONObject body = new JSONObject();
    try {
      body.put("mode", finishedMode);
      body.put("durationSeconds", seconds);
      body.put("startedAt", startedAt != null ? startedAt : Ui.nowIso());
      body.put("endedAt", Ui.nowIso());
      body.put("completed", completed);
      if (task != null) {
        body.put("taskId", Ui.longValue(task, "id", 0));
      }
    } catch (Exception ignored) {
      // JSONObject 写入不会失败
    }
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.postSession(body);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            if (!completed) {
              toast("已记录本次时长");
            } else if (MODE_FOCUS.equals(finishedMode)) {
              toast("专注完成，已记录");
            } else {
              toast("休息结束，已记录");
            }
            refresh();
          }

          @Override
          public void onError(Exception error) {
            handleApiError(error);
          }
        });
  }
}
