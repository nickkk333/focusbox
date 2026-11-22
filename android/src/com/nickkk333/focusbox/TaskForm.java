package com.nickkk333.focusbox;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/** 新建任务与删除确认；详情页见 {@link TaskDetailPage}。 */
public final class TaskForm {
  private static final String[] PRIORITY_LABELS = {"无", "低", "中", "高"};
  private static final String[] TYPE_LABELS = {"单次任务", "每日打卡"};

  private TaskForm() {}

  public static void showDetail(MainActivity app, JSONObject task, Runnable onChanged) {
    TaskDetailPage.show(app, task, onChanged);
  }

  public static void showCreate(final MainActivity app, final Runnable onCreated) {
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return app.api().projects();
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            buildCreate(app, Ui.array(value, "projects"), onCreated);
          }

          @Override
          public void onError(Exception error) {
            Ui.toast(app, error == null ? "无法加载项目列表" : error.getMessage());
          }
        });
  }

  private static void buildCreate(final MainActivity app, final JSONArray projects, final Runnable onCreated) {
    LinearLayout column = Ui.column(app);
    int side = Ui.dp(app, 20);
    column.setPadding(side, Ui.dp(app, 8), side, 0);

    column.addView(Ui.label(app, "任务标题"));
    final EditText titleField = Ui.field(app, "今天要完成什么？", InputType.TYPE_CLASS_TEXT);
    column.addView(titleField, fieldParams(app));

    column.addView(Ui.label(app, "优先级"));
    final Spinner prioritySpinner = spinner(app, PRIORITY_LABELS);
    prioritySpinner.setSelection(2);
    column.addView(prioritySpinner, fieldParams(app));

    column.addView(Ui.label(app, "所属项目"));
    final String[] projectNames = new String[projects.length() + 1];
    projectNames[0] = "未分类";
    for (int i = 0; i < projects.length(); i++) {
      projectNames[i + 1] = Ui.str(Ui.item(projects, i), "name");
    }
    final Spinner projectSpinner = spinner(app, projectNames);
    column.addView(projectSpinner, fieldParams(app));

    column.addView(Ui.label(app, "任务类型"));
    final Spinner typeSpinner = spinner(app, TYPE_LABELS);
    column.addView(typeSpinner, fieldParams(app));

    column.addView(Ui.label(app, "截止日期"));
    final TextView dueField = Ui.dateField(app, "选择日期（每日打卡必填）");
    final String[] dueValue = {""};
    dueField.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            Ui.pickDate(
                app,
                dueValue[0],
                new Ui.DateCallback() {
                  @Override
                  public void onDate(String value) {
                    dueValue[0] = value;
                    dueField.setText(value);
                    dueField.setTextColor(Ui.TEXT);
                  }
                });
          }
        });
    column.addView(dueField, fieldParams(app));

    column.addView(Ui.label(app, "预计时长（分钟）"));
    final EditText estimateField = Ui.field(app, "可选", InputType.TYPE_CLASS_NUMBER);
    column.addView(estimateField, fieldParams(app));

    column.addView(Ui.label(app, "备注"));
    final EditText notesField = Ui.area(app, "可填写补充说明", 3);
    column.addView(notesField, fieldParams(app));

    ScrollView scroll = new ScrollView(app);
    scroll.addView(
        column,
        new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    final AlertDialog dialog =
        new AlertDialog.Builder(app)
            .setTitle("新建任务")
            .setView(scroll)
            .setNegativeButton("取消", null)
            .setPositiveButton("创建", null)
            .create();
    dialog.setOnShowListener(
        new DialogInterface.OnShowListener() {
          @Override
          public void onShow(DialogInterface ignored) {
            dialog
                .getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(
                    new View.OnClickListener() {
                      @Override
                      public void onClick(View view) {
                        String title = titleField.getText().toString().trim();
                        if (title.isEmpty()) {
                          Ui.toast(app, "任务标题不能为空");
                          return;
                        }
                        int type = typeSpinner.getSelectedItemPosition();
                        if (type == 1 && dueValue[0].isEmpty()) {
                          Ui.toast(app, "每日打卡任务需要设置结束日期");
                          return;
                        }
                        JSONObject body = new JSONObject();
                        try {
                          body.put("title", title);
                          body.put("notes", notesField.getText().toString());
                          body.put("priority", prioritySpinner.getSelectedItemPosition());
                          body.put("taskType", type == 1 ? "daily" : "single");
                          int projectIndex = projectSpinner.getSelectedItemPosition();
                          if (projectIndex > 0) {
                            body.put("projectId", Ui.longValue(Ui.item(projects, projectIndex - 1), "id", 0));
                          }
                          if (!dueValue[0].isEmpty()) body.put("dueDate", dueValue[0]);
                          String estimate = estimateField.getText().toString().trim();
                          if (!estimate.isEmpty()) {
                            body.put("estimateMinutes", Integer.parseInt(estimate));
                          }
                        } catch (Exception ignoredWrite) {
                          // JSONObject 写入不会失败
                        }
                        create(app, body, dialog, onCreated);
                      }
                    });
          }
        });
    dialog.show();
  }

  private static void create(
      final MainActivity app, final JSONObject body, final AlertDialog dialog, final Runnable onCreated) {
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return app.api().createTask(body);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            dialog.dismiss();
            Ui.toast(app, "任务已创建");
            onCreated.run();
          }

          @Override
          public void onError(Exception error) {
            Ui.toast(app, error == null ? "创建失败" : error.getMessage());
          }
        });
  }

  public static void confirmDelete(final MainActivity app, final JSONObject task, final Runnable onDeleted) {
    final long id = Ui.longValue(task, "id", 0);
    String title = Ui.str(task, "title");
    new AlertDialog.Builder(app)
        .setTitle("删除任务")
        .setMessage("删除后无法恢复，相关的子任务、时间记录和专注记录关联也会被清除。")
        .setPositiveButton(
            "删除",
            new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface dialog, int which) {
                Async.run(
                    new Async.Work<JSONObject>() {
                      @Override
                      public JSONObject run() throws Exception {
                        return app.api().deleteTask(id);
                      }
                    },
                    new Async.Done<JSONObject>() {
                      @Override
                      public void onSuccess(JSONObject value) {
                        Ui.toast(app, "任务已删除");
                        onDeleted.run();
                      }

                      @Override
                      public void onError(Exception error) {
                        Ui.toast(app, error == null ? "删除失败" : error.getMessage());
                      }
                    });
              }
            })
        .setNegativeButton("取消", null)
        .show();
  }

  private static Spinner spinner(Context context, String[] labels) {
    Spinner spinner = new Spinner(context);
    ArrayAdapter<String> adapter =
        new ArrayAdapter<>(context, android.R.layout.simple_spinner_item, labels);
    adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
    spinner.setAdapter(adapter);
    return spinner;
  }

  private static LinearLayout.LayoutParams fieldParams(Context context) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.topMargin = Ui.dp(context, 6);
    params.bottomMargin = Ui.dp(context, 10);
    return params;
  }
}
