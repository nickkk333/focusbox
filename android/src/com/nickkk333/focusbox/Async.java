package com.nickkk333.focusbox;

import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 后台线程执行网络请求，结果回到主线程。 */
public final class Async {
  public interface Work<T> {
    T run() throws Exception;
  }

  public interface Done<T> {
    void onSuccess(T value);

    void onError(Exception error);
  }

  private static final ExecutorService POOL = Executors.newFixedThreadPool(4);
  private static final Handler MAIN = new Handler(Looper.getMainLooper());

  private Async() {}

  public static <T> void run(final Work<T> work, final Done<T> done) {
    POOL.execute(
        new Runnable() {
          @Override
          public void run() {
            try {
              final T value = work.run();
              MAIN.post(
                  new Runnable() {
                    @Override
                    public void run() {
                      done.onSuccess(value);
                    }
                  });
            } catch (final Exception error) {
              MAIN.post(
                  new Runnable() {
                    @Override
                    public void run() {
                      done.onError(error);
                    }
                  });
            }
          }
        });
  }
}
