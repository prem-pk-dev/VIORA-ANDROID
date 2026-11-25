#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "viora-music-session-"));
const fixture = path.join(root, "pwa");
fs.mkdirSync(path.join(fixture, "js"), { recursive: true });
fs.writeFileSync(path.join(fixture, "js", "media-session.js"), `import { state } from "./state.js";
import { audioEngine } from "./audio-engine.js";
import { storage } from "./storage.js";

export function initMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const updateMetadata = (song) => {
    if (!song) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: song.title });
  };
  const actionHandlers = new Map();
  let nativeRadioMode = false;
  const registerAction = (action, handler) => {
    actionHandlers.set(action, handler);
    if (nativeRadioMode) return;
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (e) {
      console.debug("Media Session action not supported: " + action);
    }
  };
  registerAction("play", () => audioEngine.play());
  registerAction("pause", () => audioEngine.pause());
  registerAction("previoustrack", () => audioEngine.prevTrack());
  registerAction("nexttrack", () => audioEngine.nextTrack());
  registerAction("seekto", (details) => audioEngine.seek(details.seekTime));
  state.subscribe("songChanged", (song) => updateMetadata(song));
  state.subscribe("playbackStateChanged", (isPlaying) => {
    if (!nativeRadioMode) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  });
  state.subscribe("timeUpdate", ({ currentTime, duration }) => {
    if (!nativeRadioMode && "setPositionState" in navigator.mediaSession && duration > 0 && currentTime <= duration) {
      try { navigator.mediaSession.setPositionState({ duration, position: currentTime }); } catch (e) {}
    }
  });
  if (!nativeRadioMode && state.currentSong) {
    updateMetadata(state.currentSong);
  }
}
`);
fs.writeFileSync(path.join(fixture, "js", "android-radio-adapter.js"), `    if (message?.version !== 1) return;
    if (message.type === "radio.state" || message.type === "radio.snapshot" || message.type === "radio.stopped") {
      applyNativeState(message);
    }
`);
const patcher = path.resolve("scripts", "patch-android-music-session.mjs");
const first = spawnSync(process.execPath, [patcher, fixture], { encoding: "utf8" });
assert.equal(first.status, 0, first.stderr || first.stdout);
const media = fs.readFileSync(path.join(fixture, "js", "media-session.js"), "utf8");
const adapter = fs.readFileSync(path.join(fixture, "js", "android-radio-adapter.js"), "utf8");
assert.ok(media.includes("VIORA_ANDROID_MUSIC_MEDIA_SESSION_V1"));
assert.ok(media.includes('sendNative("music.update"'));
assert.ok(media.includes('if (!("mediaSession" in navigator) && !nativeBridgeAvailable) return;'));
assert.ok(media.includes('nativeActions.set'));
assert.ok(media.includes('previoustrack: "previous"'));
assert.ok(media.includes('nexttrack: "next"'));
assert.ok(media.includes('seekto: "seek"'));
assert.ok(media.includes('publishNative(state.currentSong, state.isPlaying)'));
assert.ok(media.includes('song.source === "radio" || state.isStream'));
assert.ok(media.includes('if (isAndroidShell() || nativeRadioMode) return;'));
assert.ok(adapter.includes('message.type === "music.action"'));
assert.ok(fs.existsSync(path.join(fixture, "android-music-media-session-patch-report.json")));
const second = spawnSync(process.execPath, [patcher, fixture], { encoding: "utf8" });
assert.notEqual(second.status, 0, "patcher must reject duplicate application");
fs.rmSync(root, { recursive: true, force: true });
if (!patched.includes("artworkUrl: song.artwork")) throw new Error("Native MediaSession artwork URL is not published");
console.log("PASS: native music session patch applies once and routes metadata/actions/artwork.");
