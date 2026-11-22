package com.nickkk333.focusbox;

import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** 统计：专注趋势、完成情况与项目时间分布。 */
public class StatsScreen extends BaseScreen {
  private static final int[] RANGES = {7, 30, 90};

  private final LinearLayout summaryCard;
  private final LinearLayout chartCard;
  private final LinearLayout projectCard;
  private final LinearLayout rangeRow;
  private final TextView[] rangeChips = new TextView[RANGES.length];
  private final BarChart chart;

  private int days = RANGES[0];
  private long loadToken;

  public StatsScreen(MainActivity app) {
    super(app);
    chart = new BarChart(app);
    summaryCard = Ui.card(app);
    chartCard = Ui.card(app);
    projectCard = Ui.card(app);

    ScrollView scroll = new ScrollView(app);
    scroll.setFillViewport(true);
    LinearLayout column = Ui.column(app);
    int side = Ui.dp(app, 16);
    column.setPadding(side, side, side, Ui.dp(app, 24));
    scroll.addView(
        column,
        new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    rangeRow = Ui.row(app);
    for (int i = 0; i < RANGES.length; i++) {
      final int index = i;
      TextView chip = Ui.chip(app, RANGES[i] + " 天", i == 0);
      chip.setOnClickListener(
          new View.OnClickListener() {
            @Override
            public void onClick(View view) {
              days = RANGES[index];
              updateRangeChips();
              refresh();
            }
          });
      rangeChips[i] = chip;
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      if (i > 0) params.leftMargin = Ui.dp(app, 8);
      rangeRow.addView(chip, params);
    }
    column.addView(rangeRow);

    column.addView(summaryCard, Ui.cardParams(app));
    column.addView(chartCard, Ui.cardParams(app));
    column.addView(projectCard, Ui.cardParams(app));

    addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
  }

  @Override
  public String title() {
    return "统计";
  }

  private void updateRangeChips() {
    for (int i = 0; i < rangeChips.length; i++) {
      boolean selected = RANGES[i] == days;
      rangeChips[i].setTextColor(selected ? android.graphics.Color.WHITE : Ui.MUTED);
      rangeChips[i].setBackground(Ui.rounded(app, selected ? Ui.PRIMARY : Ui.CARD, selected ? 0 : Ui.BORDER, 999));
      rangeChips[i].setTypeface(null, selected ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL);
    }
  }

  @Override
  public void refresh() {
    final long token = ++loadToken;
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.stats(days, Ui.tzOffset(), Ui.today());
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            if (token != loadToken) return;
            render(value);
          }

          @Override
          public void onError(Exception error) {
            if (token != loadToken) return;
            handleApiError(error);
          }
        });
  }

  private void render(JSONObject value) {
    JSONObject totals = Ui.object(value, "totals");
    JSONObject tasks = Ui.object(value, "tasks");
    JSONArray daily = Ui.array(value, "daily");
    JSONArray projects = Ui.array(value, "projects");

    summaryCard.removeAllViews();
    summaryCard.addView(Ui.label(app, "总专注时长"));
    TextView total = Ui.text(app, Ui.durationText(Ui.intValue(totals, "focusSeconds", 0)), 26, Ui.TEXT, true);
    LinearLayout.LayoutParams totalParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    totalParams.topMargin = Ui.dp(app, 4);
    summaryCard.addView(total, totalParams);
    summaryCard.addView(Ui.divider(app), dividerParams());

    addStatRow(summaryCard, "日均专注", Ui.durationText(Ui.intValue(totals, "averageSeconds", 0)));
    addStatRow(summaryCard, "完成番茄", Ui.intValue(totals, "focusSessions", 0) + " 个");
    addStatRow(summaryCard, "连续专注", Ui.intValue(totals, "streak", 0) + " 天");
    addStatRow(summaryCard, "今日专注", Ui.durationText(Ui.intValue(totals, "todayFocusSeconds", 0)));
    addStatRow(summaryCard, "完成任务", Ui.intValue(tasks, "done", 0) + " 个");
    addStatRow(summaryCard, "待办任务", Ui.intValue(tasks, "open", 0) + " 个");
    addStatRow(summaryCard, "新增备忘", Ui.intValue(totals, "createdMemos", 0) + " 条");

    renderChart(daily);
    renderProjects(projects);
  }

  private void renderChart(JSONArray daily) {
    int count = daily.length();
    int[] minutes = new int[count];
    String[] labels = new String[count];
    boolean withLabels = count <= 14;
    for (int i = 0; i < count; i++) {
      JSONObject day = Ui.item(daily, i);
      minutes[i] = Math.round(Ui.intValue(day, "focusSeconds", 0) / 60f);
      labels[i] = withLabels ? Ui.str(day, "date") : "";
      if (withLabels && labels[i].length() >= 10) {
        labels[i] = labels[i].substring(5);
      }
    }
    chartCard.removeAllViews();
    chartCard.addView(Ui.sectionTitle(app, "专注趋势"));
    chart.setData(minutes, withLabels ? labels : new String[0]);
    LinearLayout.LayoutParams chartParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(app, 150));
    chartParams.topMargin = Ui.dp(app, 12);
    chartCard.addView(chart, chartParams);
  }

  private void renderProjects(JSONArray projects) {
    projectCard.removeAllViews();
    projectCard.addView(Ui.sectionTitle(app, "项目时间分布"));
    if (projects.length() == 0) {
      TextView empty = Ui.text(app, "最近还没有专注记录", 13, Ui.MUTED, false);
      LinearLayout.LayoutParams emptyParams =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      emptyParams.topMargin = Ui.dp(app, 10);
      projectCard.addView(empty, emptyParams);
      return;
    }
    for (int i = 0; i < projects.length(); i++) {
      JSONObject project = Ui.item(projects, i);
      LinearLayout row = Ui.row(app);
      LinearLayout.LayoutParams rowParams =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      rowParams.topMargin = Ui.dp(app, 10);
      projectCard.addView(row, rowParams);

      LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(Ui.dp(app, 8), Ui.dp(app, 8));
      dotParams.rightMargin = Ui.dp(app, 8);
      row.addView(Ui.dot(app, Ui.color(Ui.str(project, "color"), Ui.MUTED), 8), dotParams);

      String name = Ui.str(project, "name");
      TextView nameView = Ui.text(app, name.isEmpty() ? "未命名项目" : name, 14, Ui.TEXT, false);
      row.addView(nameView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

      TextView seconds = Ui.text(app, Ui.durationText(Ui.intValue(project, "seconds", 0)), 12, Ui.MUTED, false);
      row.addView(seconds);
    }
  }

  private void addStatRow(LinearLayout parent, String label, String value) {
    LinearLayout row = Ui.row(app);
    LinearLayout.LayoutParams rowParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    rowParams.topMargin = Ui.dp(app, 10);
    parent.addView(row, rowParams);

    TextView labelView = Ui.text(app, label, 13, Ui.MUTED, false);
    row.addView(labelView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

    TextView valueView = Ui.text(app, value, 14, Ui.TEXT, true);
    valueView.setGravity(Gravity.END);
    row.addView(valueView);
    row.setGravity(Gravity.CENTER_VERTICAL);
  }

  private LinearLayout.LayoutParams dividerParams() {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.topMargin = Ui.dp(app, 12);
    return params;
  }
}
