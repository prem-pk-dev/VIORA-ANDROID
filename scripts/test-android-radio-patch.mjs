#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "viora-radio-patch-"));
const fixture = path.join(root, "pwa");
fs.mkdirSync(path.join(fixture, "js"), { recursive: true });
const audio = `import { state } from "./state.js";
import { storage } from "./storage.js";
import { youtubePlayer } from "./youtube-player.js";
import { showToast } from "./components.js";
import { playbackAnalytics } from "./playback-analytics.js";

class AudioEngine {
  playRadio(station) {
    if (!station) return;
    this.ensureContext();
  }

  play() {
    this.ensureContext();
    const song = state.currentSong;
    const isRadio = state.isStream || (song && (song.source === "radio" || song.isLive));

    // If current song is not from YouTube,
    if (isRadio) {
      // 2. Live Radio Stream
      youtubePlayer.pause();
    }
  }

  pause() {
    const isRadio = true;
    if (false) {
    } else if (isRadio) {
      if (this.radioAudio) this.radioAudio.pause();
    }
  }

  setVolume(val) {
    const vol = Math.max(0, Math.min(1, val));
    if (this.radioAudio) {
      this.radioAudio.volume = state.isMuted ? 0 : vol;
    }
    youtubePlayer.setVolume(state.isMuted ? 0 : vol);
  }
}
`;
fs.writeFileSync(path.join(fixture, "js", "audio-engine.js"), audio);

const patcher = path.resolve("scripts", "patch-android-radio.mjs");
const first = spawnSync(process.execPath, [patcher, fixture], { encoding: "utf8" });
assert.equal(first.status, 0, first.stderr || first.stdout);
const patched = fs.readFileSync(path.join(fixture, "js", "audio-engine.js"), "utf8");
assert.ok(patched.includes("VIORA_ANDROID_RADIO_ADAPTER_V1"));
assert.ok(patched.includes("androidRadioAdapter.isAndroidShell()"));
assert.ok(fs.existsSync(path.join(fixture, "js", "android-radio-adapter.js")));
assert.ok(fs.existsSync(path.join(fixture, "android-radio-patch-report.json")));

const second = spawnSync(process.execPath, [patcher, fixture], { encoding: "utf8" });
assert.notEqual(second.status, 0, "second patch run must refuse duplicate application");
assert.match(second.stderr + second.stdout, /already applied/);

fs.rmSync(root, { recursive: true, force: true });
console.log("PASS: patcher applies once, copies adapter, writes report, and rejects duplicate application.");
