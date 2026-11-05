#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [ -z "$SDK" ] || [ ! -f "$SDK/platforms/android-34/android.jar" ]; then
  echo "Android SDK 34 not found. Set ANDROID_SDK_ROOT or install platforms;android-34." >&2
  exit 1
fi

BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-34.0.0}"
BUILD_TOOLS="$SDK/build-tools/$BUILD_TOOLS_VERSION"
AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"
ANDROID_JAR="$SDK/platforms/android-34/android.jar"

for tool in "$AAPT2" "$D8" "$ZIPALIGN" "$APKSIGNER" "$ANDROID_JAR"; do
  if [ ! -e "$tool" ]; then
    echo "Build tool not found: $tool" >&2
    exit 1
  fi
done

MANIFEST_VERSION="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml | head -n1)"
VERSION="${APP_VERSION:-$MANIFEST_VERSION}"
if [ -z "$VERSION" ]; then
  echo "Unable to resolve version." >&2
  exit 1
fi
if [ "$VERSION" != "$MANIFEST_VERSION" ]; then
  echo "Warning: APP_VERSION=$VERSION but AndroidManifest versionName=$MANIFEST_VERSION" >&2
fi

KEYSTORE="${ANDROID_KEYSTORE_PATH:-$PROJECT_DIR/keystore/focusbox.jks}"
KEY_ALIAS="${ANDROID_KEY_ALIAS:-focusbox}"
STORE_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-focusbox}"
KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-focusbox}"

rm -rf build dist
mkdir -p build/classes build/dex dist

if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > build/focusbox-ci.jks
  KEYSTORE="$PROJECT_DIR/build/focusbox-ci.jks"
fi
if [ ! -f "$KEYSTORE" ]; then
  echo "Keystore not found: $KEYSTORE" >&2
  exit 1
fi

echo "Compiling resources..."
"$AAPT2" compile --dir res -o build/res.zip

echo "Linking resources and manifest..."
"$AAPT2" link -o build/base.apk \
  -I "$ANDROID_JAR" \
  --manifest AndroidManifest.xml \
  build/res.zip \
  --auto-add-overlay

echo "Compiling Java..."
mapfile -t SOURCES < <(find src -name '*.java' -print)
javac -encoding UTF-8 -source 17 -target 17 \
  -classpath "$ANDROID_JAR" -d build/classes "${SOURCES[@]}"

jar --create --file build/classes.jar -C build/classes .

echo "Dexing..."
"$D8" --lib "$ANDROID_JAR" --min-api 24 --output build/dex build/classes.jar

cp build/base.apk build/app-unsigned.apk
jar --update --file build/app-unsigned.apk -C build/dex classes.dex

echo "Aligning..."
"$ZIPALIGN" -f -p 4 build/app-unsigned.apk build/app-aligned.apk

echo "Signing..."
"$APKSIGNER" sign \
  --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$STORE_PASSWORD" --key-pass "pass:$KEY_PASSWORD" \
  --out "dist/focusbox-android-$VERSION.apk" build/app-aligned.apk

echo "Verifying..."
"$APKSIGNER" verify --verbose --print-certs "dist/focusbox-android-$VERSION.apk"

APK_PATH="$PROJECT_DIR/dist/focusbox-android-$VERSION.apk"
APK_SIZE="$(stat -c%s "$APK_PATH" 2>/dev/null || stat -f%z "$APK_PATH")"
sha256sum "$APK_PATH" > "$APK_PATH.sha256"

echo ""
echo "APK: $APK_PATH"
echo "Size: $APK_SIZE bytes"
echo "Version: $VERSION"
