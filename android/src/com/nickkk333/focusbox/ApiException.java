package com.nickkk333.focusbox;

/** 接口调用异常，status 为 0 表示网络层错误。 */
public class ApiException extends Exception {
  private final int status;

  public ApiException(int status, String message) {
    super(message);
    this.status = status;
  }

  public int getStatus() {
    return status;
  }

  public boolean isUnauthorized() {
    return status == 401;
  }
}
