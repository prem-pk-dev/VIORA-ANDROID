#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const sourceRoot = path.resolve(process.argv[2] || "viora-source");
const audioPath = path.join(sourceRoot, "js", "audio-engine.js");
const adapterSource = path.resolve("scripts", "android-radio-adapter.js");
const marker = "VIORA_ANDROID_RADIO_ADAPTER_V1";

if (!fs.existsSync(audioPath)) throw new Error("Missing PWA js/audio-engine.js");
if (!fs.existsSync(adapterSource)) throw new Error("Missing Android radio adapter source");

let source = fs.readFileSync(audioPath, "utf8");
if (source.includes(marker)) throw new Error("Android radio adapter already applied; refusing duplicate patch");

function replaceExactlyOnce(input, needle, replacement, label) {
  const count = input.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one exact anchor, found ${count}`);
  return input.replace(needle, replacement);
}

source = replaceExactlyOnce(
  source,
  'import { playbackAnalytics } from "./playback-analytics.js";',
  'import { playbackAnalytics } from "./playback-analytics.js";\nimport { androidRadioAdapter } from "./android-radio-adapter.js";',
  "adapter import"
);

source = replaceExactlyOnce(
  source,
  '  playRadio(station) {\n    if (!station) return;\n    this.ensureContext();',
  '  playRadio(station) {\n    if (!station) return;\n    if (androidRadioAdapter.isAndroidShell()) {\n      androidRadioAdapter.play(station, this);\n      return;\n    }\n    this.ensureContext();',
  "playRadio native routing"
);

source = replaceExactlyOnce(
  source,
  '  play() {\n    this.ensureContext();',
  '  async play() {\n    this.ensureContext();',
  "async source handoff"
);

source = replaceExactlyOnce(
  source,
  '    const isRadio = state.isStream || (song && (song.source === "radio" || song.isLive));\n\n    // If current song is not from YouTube,',
  '    const isRadio = state.isStream || (song && (song.source === "radio" || song.isLive));\n\n    // A native radio item must be fully cleared before another WebView-owned source starts.\n    if (!isRadio && androidRadioAdapter.isAndroidShell()) {\n      const stopped = await androidRadioAdapter.stop();\n      if (!stopped) {\n        state.isPlaying = false;\n        state.notify("playbackStateChanged", false);\n        showToast("Could not safely stop native radio; playback handoff was cancelled.", "error");\n        return;\n      }\n    }\n\n    // If current song is not from YouTube,',
  "native-to-WebView handoff"
);

source = replaceExactlyOnce(
  source,
  '    } else if (isRadio) {\n      // 2. Live Radio Stream\n      youtubePlayer.pause();',
  '    } else if (isRadio) {\n      // 2. Live Radio Stream\n      if (androidRadioAdapter.isAndroidShell()) {\n        androidRadioAdapter.resume();\n        return;\n      }\n      youtubePlayer.pause();',
  "native radio resume"
);

source = replaceExactlyOnce(
  source,
  '    } else if (isRadio) {\n      if (this.radioAudio) this.radioAudio.pause();',
  '    } else if (isRadio) {\n      if (androidRadioAdapter.isAndroidShell()) androidRadioAdapter.pause();\n      else if (this.radioAudio) this.radioAudio.pause();',
  "native radio pause"
);

source = replaceExactlyOnce(
  source,
  '    if (this.radioAudio) {\n      this.radioAudio.volume = state.isMuted ? 0 : vol;\n    }\n    youtubePlayer.setVolume',
  '    if (this.radioAudio) {\n      this.radioAudio.volume = state.isMuted ? 0 : vol;\n    }\n    if (androidRadioAdapter.isActive()) androidRadioAdapter.setVolume(state.isMuted ? 0 : vol);\n    youtubePlayer.setVolume',
  "native radio volume"
);

source = source.replace(
  'import { androidRadioAdapter } from "./android-radio-adapter.js";',
  'import { androidRadioAdapter } from "./android-radio-adapter.js";\n// ' + marker
);

fs.writeFileSync(audioPath, source);
fs.copyFileSync(adapterSource, path.join(sourceRoot, "js", "android-radio-adapter.js"));
const report = {
  marker,
  patched: [
    "adapter import",
    "playRadio native routing",
    "async source handoff",
    "native-to-WebView handoff",
    "native radio resume",
    "native radio pause",
    "native radio volume"
  ],
  files: ["js/audio-engine.js", "js/android-radio-adapter.js"]
};
fs.writeFileSync(path.join(sourceRoot, "android-radio-patch-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
