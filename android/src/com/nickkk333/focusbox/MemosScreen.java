package com.nickkk333.focusbox;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
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

/** 备忘：随手记录、搜索、置顶、编辑与删除。 */
public class MemosScreen extends BaseScreen {
  private final LinearLayout list;
  private final EditText compose;
  private final EditText searchField;
  private final Handler handler = new Handler(Looper.getMainLooper());

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

  public MemosScreen(MainActivity app) {
    super(app);

    LinearLayout header = Ui.column(app);
    int side = Ui.dp(app, 16);
    header.setPadding(side, Ui.dp(app, 12), side, Ui.dp(app, 8));

    LinearLayout composeCard = Ui.card(app);
    compose = Ui.area(app, "随手记点什么，可用 #标签", 3);
    composeCard.addView(compose, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    LinearLayout composeBar = Ui.row(app);
    LinearLayout.LayoutParams composeBarParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    composeBarParams.topMargin = Ui.dp(app, 8);
    composeCard.addView(composeBar, composeBarParams);

    TextView hint = Ui.text(app, "支持 Markdown 与 #标签", 11, Ui.MUTED, false);
    composeBar.addView(hint, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    TextView save = Ui.button(app, "保存备忘", true);
    composeBar.addView(save, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    save.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            submitMemo();
          }
        });
    header.addView(composeCard, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    searchField = Ui.field(app, "搜索备忘", InputType.TYPE_CLASS_TEXT);
    LinearLayout.LayoutParams searchParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    searchParams.topMargin = Ui.dp(app, 10);
    header.addView(searchField, searchParams);
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
    return "备忘";
  }

  @Override
  public void dispose() {
    handler.removeCallbacks(searchRunnable);
  }

  @Override
  public void refresh() {
    final long token = ++loadToken;
    final String query = keyword.isEmpty() ? "archived=0" : "archived=0&search=" + ApiClient.enc(keyword);
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.memos(query);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            if (token != loadToken) return;
            render(Ui.array(value, "memos"));
          }

          @Override
          public void onError(Exception error) {
            if (token != loadToken) return;
            handleApiError(error);
          }
        });
  }

  private void render(JSONArray memos) {
    list.removeAllViews();
    if (memos.length() == 0) {
      TextView empty = Ui.text(app, keyword.isEmpty() ? "还没有备忘，写一条试试" : "没有找到相关备忘", 13, Ui.MUTED, false);
      empty.setGravity(Gravity.CENTER);
      empty.setPadding(0, Ui.dp(app, 24), 0, Ui.dp(app, 24));
      list.addView(empty);
      return;
    }
    for (int i = 0; i < memos.length(); i++) {
      final JSONObject memo = Ui.item(memos, i);
      list.addView(buildCard(memo), cardParams(i));
    }
  }

  private LinearLayout.LayoutParams cardParams(int index) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    params.topMargin = Ui.dp(app, index == 0 ? 0 : 10);
    return params;
  }

  private View buildCard(final JSONObject memo) {
    LinearLayout card = Ui.card(app);
    long id = Ui.longValue(memo, "id", 0);
    final boolean pinned = Ui.bool(memo, "pinned");
    final String content = Ui.str(memo, "content");

    if (pinned) {
      TextView pinBadge = Ui.text(app, "已置顶", 11, Ui.PRIMARY, true);
      card.addView(pinBadge);
      LinearLayout.LayoutParams badgeParams =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      badgeParams.bottomMargin = Ui.dp(app, 6);
      pinBadge.setLayoutParams(badgeParams);
    }

    TextView contentView = Ui.text(app, content, 14, Ui.TEXT, false);
    contentView.setMaxLines(8);
    contentView.setEllipsize(TextUtils.TruncateAt.END);
    card.addView(contentView);

    String tags = tagsText(memo);
    if (!tags.isEmpty()) {
      TextView tagsView = Ui.text(app, tags, 12, Ui.PRIMARY, false);
      LinearLayout.LayoutParams tagsParams =
          new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      tagsParams.topMargin = Ui.dp(app, 6);
      card.addView(tagsView, tagsParams);
    }

    LinearLayout footer = Ui.row(app);
    LinearLayout.LayoutParams footerParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    footerParams.topMargin = Ui.dp(app, 8);
    card.addView(footer, footerParams);

    String time = Ui.formatIso(Ui.str(memo, "createdAt"), "MM-dd HH:mm");
    TextView timeView = Ui.text(app, time, 11, Ui.MUTED, false);
    footer.addView(timeView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

    TextView pin = action(pinned ? "取消置顶" : "置顶", Ui.PRIMARY);
    TextView edit = action("编辑", Ui.PRIMARY);
    TextView delete = action("删除", Ui.DANGER);
    footer.addView(pin);
    footer.addView(edit);
    footer.addView(delete);

    final long memoId = id;
    pin.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            togglePin(memoId, !pinned);
          }
        });
    edit.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            editMemo(memoId, content);
          }
        });
    delete.setOnClickListener(
        new View.OnClickListener() {
          @Override
          public void onClick(View view) {
            confirmDelete(memoId);
          }
        });
    return card;
  }

  private TextView action(String label, int color) {
    TextView view = Ui.text(app, label, 12, color, true);
    view.setPadding(Ui.dp(app, 10), Ui.dp(app, 6), Ui.dp(app, 4), Ui.dp(app, 6));
    view.setClickable(true);
    return view;
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

  private void submitMemo() {
    final String content = compose.getText().toString().trim();
    if (content.isEmpty()) {
      toast("备忘内容不能为空");
      return;
    }
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.createMemo(content);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            compose.setText("");
            toast("备忘已保存");
            refresh();
          }

          @Override
          public void onError(Exception error) {
            handleApiError(error);
          }
        });
  }

  private void editMemo(final long id, String content) {
    final EditText area = Ui.area(app, "备忘内容", 6);
    area.setText(content);
    LinearLayout wrapper = Ui.column(app);
    int side = Ui.dp(app, 20);
    wrapper.setPadding(side, Ui.dp(app, 8), side, 0);
    wrapper.addView(area, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    new AlertDialog.Builder(app)
        .setTitle("编辑备忘")
        .setView(wrapper)
        .setPositiveButton(
            "保存",
            new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface dialog, int which) {
                saveMemo(id, area.getText().toString());
              }
            })
        .setNegativeButton("取消", null)
        .show();
  }

  private void saveMemo(final long id, String content) {
    final String text = content.trim();
    if (text.isEmpty()) {
      toast("备忘内容不能为空");
      return;
    }
    JSONObject body = new JSONObject();
    try {
      body.put("content", text);
    } catch (Exception ignored) {
      // JSONObject 写入不会失败
    }
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.updateMemo(id, body);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            toast("已保存");
            refresh();
          }

          @Override
          public void onError(Exception error) {
            handleApiError(error);
          }
        });
  }

  private void togglePin(final long id, boolean pinned) {
    JSONObject body = new JSONObject();
    try {
      body.put("pinned", pinned);
    } catch (Exception ignored) {
      // JSONObject 写入不会失败
    }
    Async.run(
        new Async.Work<JSONObject>() {
          @Override
          public JSONObject run() throws Exception {
            return api.updateMemo(id, body);
          }
        },
        new Async.Done<JSONObject>() {
          @Override
          public void onSuccess(JSONObject value) {
            refresh();
          }

          @Override
          public void onError(Exception error) {
            handleApiError(error);
          }
        });
  }

  private void confirmDelete(final long id) {
    new AlertDialog.Builder(app)
        .setTitle("删除备忘")
        .setMessage("删除后无法恢复，确定继续吗？")
        .setPositiveButton(
            "删除",
            new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface dialog, int which) {
                Async.run(
                    new Async.Work<JSONObject>() {
                      @Override
                      public JSONObject run() throws Exception {
                        return api.deleteMemo(id);
                      }
                    },
                    new Async.Done<JSONObject>() {
                      @Override
                      public void onSuccess(JSONObject value) {
                        toast("备忘已删除");
                        refresh();
                      }

                      @Override
                      public void onError(Exception error) {
                        handleApiError(error);
                      }
                    });
              }
            })
        .setNegativeButton("取消", null)
        .show();
  }
}
