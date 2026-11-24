#!/usr/bin/env bash
set -euo pipefail

APK="$GITHUB_WORKSPACE/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="com.prempk.viora"
ACTIVITY="$PACKAGE/.MainActivity"

echo "Checking APK at: $APK"
if [ ! -s "$APK" ]; then
  echo "::error::APK not found at expected path: $APK"
  echo "Workspace: $GITHUB_WORKSPACE"
  find "$GITHUB_WORKSPACE" -path '*/build/outputs/apk/*/*.apk' -type f -print || true
  exit 1
fi

adb install -r "$APK"
adb shell am force-stop "$PACKAGE"
adb logcat -c

# Do not use am start -W: on a TCG software emulator it can time out while
# the app is still starting, making the test report a false launch failure.
adb shell am start -n "$ACTIVITY"

PID=""
for attempt in $(seq 1 60); do
  PID="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  if [ -n "$PID" ]; then
    break
  fi
  sleep 2
done

if [ -z "$PID" ]; then
  echo "::error::VIORA process did not start within 120 seconds."
  adb logcat -d -v brief | tail -n 250 || true
  exit 1
fi

echo "VIORA process started: $PID"

# DEBUG builds enable WebView remote debugging. Its per-process DevTools
# socket is a stable signal that the WebView engine has been instantiated.
WEBVIEW_SOCKET=""
for attempt in $(seq 1 45); do
  WEBVIEW_SOCKET="$(adb shell cat /proc/net/unix 2>/dev/null | grep -Eo "webview_devtools_remote_[0-9]+" | grep -m1 "webview_devtools_remote_$PID" || true)"
  if [ -n "$WEBVIEW_SOCKET" ]; then
    break
  fi
  sleep 2
done

if [ -z "$WEBVIEW_SOCKET" ]; then
  echo "::error::VIORA process is alive, but its WebView DevTools socket did not appear."
  adb logcat -d -v brief | grep -Ei "FATAL EXCEPTION|AndroidRuntime|chromium|WebView|ANR in $PACKAGE" | tail -n 150 || true
  exit 1
fi

echo "WebView initialized: $WEBVIEW_SOCKET"

adb shell input keyevent 3
sleep 3
adb shell am start -n "$ACTIVITY"

RESUMED_PID=""
for attempt in $(seq 1 30); do
  RESUMED_PID="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  if [ -n "$RESUMED_PID" ]; then
    break
  fi
  sleep 2
done

if [ -z "$RESUMED_PID" ]; then
  echo "::error::VIORA did not survive background-to-foreground resume."
  adb logcat -d -v brief | tail -n 250 || true
  exit 1
fi

CRASHES="$(adb logcat -d -v brief | grep -E "FATAL EXCEPTION|Process: com\\.prempk\\.viora|ANR in com\\.prempk\\.viora" || true)"
if [ -n "$CRASHES" ]; then
  echo "::error::Android runtime crash/ANR detected for VIORA."
  printf '%s\n' "$CRASHES"
  exit 1
fi

echo "PASS: install, process launch, WebView initialization, background/foreground resume, and crash/ANR scan."
