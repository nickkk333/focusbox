#!/usr/bin/env bash
#
# 构建飞牛 fnOS 安装包（离线版）。
#
# 用法：
#   ./deploy/fnos/build.sh <version> <amd64.tar> <arm64.tar> [输出目录]
#
# 示例：
#   ./deploy/fnos/build.sh 1.0.0 \
#     release/focusbox-1.0.0-amd64.tar \
#     release/focusbox-1.0.0-arm64.tar \
#     release
#
# 依赖：
#   - fnpack 1.2.3（https://static2.fnnas.com/fnpack/fnpack-1.2.3-linux-amd64）
#   - 已用 docker save 导出的 amd64 / arm64 镜像 tar
#
# 脚本会在临时目录中组装，不会修改源目录里的 manifest 或 cmd 脚本。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-${VERSION:-}}"
AMD64_TAR="${2:-}"
ARM64_TAR="${3:-}"
OUT_DIR="${4:-${SCRIPT_DIR}/../../release}"
FNPACK="${FNPACK_BIN:-fnpack}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

if [ -z "$VERSION" ]; then
  die "缺少版本号。用法：$0 <version> <amd64.tar> <arm64.tar> [输出目录]"
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  die "版本号必须为 X.Y.Z（当前：$VERSION）"
fi

[ -f "$AMD64_TAR" ] || die "找不到 amd64 镜像 tar：$AMD64_TAR"
[ -f "$ARM64_TAR" ] || die "找不到 arm64 镜像 tar：$ARM64_TAR"

if ! command -v "$FNPACK" >/dev/null 2>&1; then
  die "找不到 fnpack。请安装 fnpack 1.2.3，或通过 FNPACK_BIN 指定路径。"
fi

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

STAGE="$(mktemp -d)"
cleanup() {
  rm -rf "$STAGE"
}
trap cleanup EXIT

# 复制完整 fpk 工程到临时目录，避免修改工作区文件。
cp -a "$SCRIPT_DIR/." "$STAGE/"
rm -f "$STAGE"/*.fpk 2>/dev/null || true
# fnpack 会把 .DS_Store 一并打进包里，先清理掉。
find "$STAGE" -name '.DS_Store' -delete 2>/dev/null || true
rm -rf "$STAGE/app/images"
mkdir -p "$STAGE/app/images"

cp "$AMD64_TAR" "$STAGE/app/images/focusbox-amd64.tar"
cp "$ARM64_TAR" "$STAGE/app/images/focusbox-arm64.tar"

# 写入版本号，并锁定 cmd/main 使用的镜像 tag。
sed -i -E "s/^version=.*/version=${VERSION}/" "$STAGE/manifest"
sed -i -E "s|^IMAGE_TAG=.*|IMAGE_TAG=\"${VERSION}\"|" "$STAGE/cmd/main"

# Windows 工作区可能带 CRLF；fnOS 上的 #!/bin/bash\r 会报 bad interpreter。
for f in "$STAGE"/cmd/* "$STAGE/manifest" "$STAGE"/config/* "$STAGE"/wizard/* "$STAGE"/app/ui/config; do
  [ -f "$f" ] || continue
  if grep -q $'\r' "$f" 2>/dev/null; then
    tr -d '\r' < "$f" > "$f.tmp"
    mv "$f.tmp" "$f"
  fi
done

chmod +x "$STAGE"/cmd/*

echo "使用 fnpack 打包 focusbox ${VERSION} ..."
(
  cd "$STAGE"
  "$FNPACK" build
)

PRODUCED="$(find "$STAGE" -maxdepth 1 -type f -name '*.fpk' -print -quit)"
[ -n "$PRODUCED" ] || die "fnpack 未生成 .fpk 文件"

OUT_FILE="${OUT_DIR}/focusbox-fnos-${VERSION}.fpk"
cp "$PRODUCED" "$OUT_FILE"

(
  cd "$OUT_DIR"
  sha256sum "$(basename "$OUT_FILE")" > "$(basename "$OUT_FILE").sha256"
)

echo ""
echo "构建完成："
echo "  ${OUT_FILE}"
echo "  ${OUT_FILE}.sha256"
