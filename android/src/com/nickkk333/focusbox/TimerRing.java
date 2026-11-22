package com.nickkk333.focusbox;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.AttributeSet;
import android.view.View;

/** 番茄钟进度环。 */
public class TimerRing extends View {
  private final Paint basePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint arcPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint timePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Paint subPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
  private final RectF rect = new RectF();

  private float progress = 1f;
  private String timeText = "25:00";
  private String subtitle = "专注";
  private int accent = Ui.PRIMARY;

  public TimerRing(Context context) {
    super(context);
    init();
  }

  public TimerRing(Context context, AttributeSet attrs) {
    super(context, attrs);
    init();
  }

  private void init() {
    Context context = getContext();
    int stroke = Ui.dp(context, 12);
    basePaint.setStyle(Paint.Style.STROKE);
    basePaint.setStrokeWidth(stroke);
    basePaint.setStrokeCap(Paint.Cap.ROUND);
    basePaint.setColor(Color.parseColor("#E5E7EB"));

    arcPaint.setStyle(Paint.Style.STROKE);
    arcPaint.setStrokeWidth(stroke);
    arcPaint.setStrokeCap(Paint.Cap.ROUND);

    timePaint.setTypeface(Typeface.DEFAULT_BOLD);
    timePaint.setColor(Ui.TEXT);
    timePaint.setTextAlign(Paint.Align.CENTER);
    timePaint.setTextSize(Ui.dp(context, 40));

    subPaint.setColor(Ui.MUTED);
    subPaint.setTextAlign(Paint.Align.CENTER);
    subPaint.setTextSize(Ui.dp(context, 13));
  }

  public void setProgress(float value) {
    progress = Math.max(0f, Math.min(1f, value));
    invalidate();
  }

  public void setTime(String value) {
    timeText = value;
    invalidate();
  }

  public void setSubtitle(String value) {
    subtitle = value;
    invalidate();
  }

  public void setAccent(int color) {
    accent = color;
    invalidate();
  }

  @Override
  protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
    int width = MeasureSpec.getSize(widthMeasureSpec);
    int height = MeasureSpec.getSize(heightMeasureSpec);
    int size;
    if (width > 0 && height > 0) {
      size = Math.min(width, height);
    } else {
      size = Math.max(width, height);
    }
    if (size <= 0) size = Ui.dp(getContext(), 220);
    setMeasuredDimension(size, size);
  }

  @Override
  protected void onDraw(Canvas canvas) {
    Context context = getContext();
    float stroke = basePaint.getStrokeWidth();
    float inset = stroke / 2f + Ui.dp(context, 6);
    rect.set(inset, inset, getWidth() - inset, getHeight() - inset);

    canvas.drawArc(rect, 0f, 360f, false, basePaint);
    arcPaint.setColor(accent);
    canvas.drawArc(rect, -90f, 360f * progress, false, arcPaint);

    float centerX = getWidth() / 2f;
    float centerY = getHeight() / 2f;
    canvas.drawText(timeText, centerX, centerY + Ui.dp(context, 6), timePaint);
    canvas.drawText(subtitle, centerX, centerY + Ui.dp(context, 32), subPaint);
  }
}
