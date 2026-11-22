package com.nickkk333.focusbox;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

/** 简单的每日专注柱状图。 */
public class BarChart extends View {
  private final Paint barPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint labelPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final RectF bar = new RectF();

  private int[] minutes = new int[0];
  private String[] labels = new String[0];

  public BarChart(Context context) {
    super(context);
    init();
  }

  public BarChart(Context context, AttributeSet attrs) {
    super(context, attrs);
    init();
  }

  private void init() {
    barPaint.setColor(Ui.PRIMARY);
    labelPaint.setColor(Ui.MUTED);
    labelPaint.setTextSize(Ui.dp(getContext(), 9));
    labelPaint.setTextAlign(Paint.Align.CENTER);
  }

  public void setData(int[] values, String[] labelTexts) {
    minutes = values == null ? new int[0] : values;
    labels = labelTexts == null ? new String[0] : labelTexts;
    invalidate();
  }

  @Override
  protected void onDraw(Canvas canvas) {
    int count = minutes.length;
    if (count == 0) return;

    float width = getWidth();
    float height = getHeight();
    float labelHeight = labels.length == count ? Ui.dp(getContext(), 14) : 0f;
    float chartHeight = height - labelHeight - Ui.dp(getContext(), 4);

    int max = 1;
    for (int value : minutes) {
      if (value > max) max = value;
    }

    float slot = width / count;
    float barWidth = Math.max(Ui.dp(getContext(), 2), slot * 0.6f);
    float radius = Ui.dp(getContext(), 3);
    int emptyColor = Color.parseColor("#E5E7EB");

    for (int i = 0; i < count; i++) {
      float left = i * slot + (slot - barWidth) / 2f;
      float barHeight = chartHeight * (minutes[i] / (float) max);
      barPaint.setColor(minutes[i] > 0 ? Ui.PRIMARY : emptyColor);
      bar.set(left, chartHeight - barHeight, left + barWidth, chartHeight);
      canvas.drawRoundRect(bar, radius, radius, barPaint);

      if (labels.length == count && count <= 14) {
        String label = labels[i];
        if (label != null && !label.isEmpty()) {
          canvas.drawText(label, left + barWidth / 2f, height - Ui.dp(getContext(), 3), labelPaint);
        }
      }
    }
  }
}
