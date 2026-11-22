#!/usr/bin/env bash
set -euo pipefail

APK="$GITHUB_WORKSPACE/app/build/outputs/apk/debug/app-debug.apk"
echo "Checking APK at: $APK"
if [ ! -s "$APK" ]; then
  echo "::error::APK not found at expected path: $APK"
  echo "Workspace: $GITHUB_WORKSPACE"
  find "$GITHUB_WORKSPACE" -path '*/build/outputs/apk/*/*.apk' -type f -print || true
  exit 1
fi

adb install -r "$APK"
adb shell am force-stop com.prempk.viora
adb shell am start -W -n com.prempk.viora/.MainActivity
sleep 25

if ! adb shell pidof com.prempk.viora >/dev/null; then
  echo "::error::VIORA process exited after launch."
  adb logcat -d -v brief | grep -E "FATAL EXCEPTION|Process: com\\.prempk\\.viora|ANR in com\\.prempk\\.viora" || true
  exit 1
fi

adb shell uiautomator dump /sdcard/viora-window.xml >/dev/null
adb pull /sdcard/viora-window.xml "$GITHUB_WORKSPACE/viora-window.xml" >/dev/null
if ! grep -q "android.webkit.WebView" "$GITHUB_WORKSPACE/viora-window.xml"; then
  echo "::error::VIORA WebView was not present in the Android UI hierarchy."
  cat "$GITHUB_WORKSPACE/viora-window.xml"
  exit 1
fi

adb shell input keyevent 3
sleep 2
adb shell am start -W -n com.prempk.viora/.MainActivity
sleep 8

if ! adb shell pidof com.prempk.viora >/dev/null; then
  echo "::error::VIORA did not survive background-to-foreground resume."
  exit 1
fi

CRASHES="$(adb logcat -d -v brief | grep -E "FATAL EXCEPTION|Process: com\\.prempk\\.viora|ANR in com\\.prempk\\.viora" || true)"
if [ -n "$CRASHES" ]; then
  echo "::error::Android runtime crash/ANR detected for VIORA."
  printf '%s\\n' "$CRASHES"
  exit 1
fi

echo "PASS: install, launch, WebView presence, background/foreground resume, and crash/ANR scan."
