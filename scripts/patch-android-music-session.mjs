#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "viora-source");
const mediaPath = path.join(root, "js", "media-session.js");
const adapterPath = path.join(root, "js", "android-radio-adapter.js");
const marker = "VIORA_ANDROID_MUSIC_MEDIA_SESSION_V1";
for (const file of [mediaPath, adapterPath]) if (!fs.existsSync(file)) throw new Error("Missing " + path.relative(root, file));
let media = fs.readFileSync(mediaPath, "utf8");
let adapter = fs.readFileSync(adapterPath, "utf8");
if (media.includes(marker) || adapter.includes(marker)) throw new Error("Android music media-session patch already applied");
function once(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(label + ": expected one anchor, found " + count);
  return source.replace(anchor, replacement);
}
media = once(media,
  '  if (!("mediaSession" in navigator)) return;',
  '  const nativeBridgeAvailable = (() => { try { return window.VioraAndroid?.isAndroidApp?.() === true && typeof window.VioraNative?.postMessage === "function"; } catch (_) { return false; } })();\n  if (!("mediaSession" in navigator) && !nativeBridgeAvailable) return;',
  "Android WebView without browser Media Session support");
media = once(media,
  '  const updateMetadata = (song) => {\n    if (!song) return;',
  '  const isAndroidShell = () => { try { return window.VioraAndroid?.isAndroidApp?.() === true && typeof window.VioraNative?.postMessage === "function"; } catch (_) { return false; } };\n  const nativeActions = new Map();\n  let nativeRequest = 0;\n  const sendNative = (command, fields = {}) => { if (!isAndroidShell()) return; try { window.VioraNative.postMessage(JSON.stringify({ version: 1, requestId: "viora-music-" + (++nativeRequest), command, ...fields })); } catch (_) {} };\n  const publishNative = (song = state.currentSong, playing = state.isPlaying) => { if (!song || song.source === "radio" || state.isStream) return; sendNative("music.update", { title: song.title || "Unknown Title", artist: song.artist || "Unknown Artist", album: song.album || "VIORA", artworkUrl: (() => { const art = song.artwork || song.artworkUrl || song.image; return typeof art === "string" && art.startsWith("https://") && art.length <= 2048 ? art : ""; })(), playing: Boolean(playing), duration: Number.isFinite(Number(song.duration)) ? Math.max(0, Math.min(86400000, Number(song.duration) * 1000)) : 0 }); };\n  window.addEventListener("viora-native-music-action", (event) => { const action = event.detail?.action; const handler = nativeActions.get(action); if (handler) handler(action === "seek" ? { seekTime: Number(event.detail?.position || 0) / 1000 } : {}); });\n  const updateMetadata = (song) => {\n    if (!song) return;\n    if (isAndroidShell()) { publishNative(song); return; }',
  "Android native metadata routing");
media = once(media,
  '  const registerAction = (action, handler) => {\n    actionHandlers.set(action, handler);\n    if (nativeRadioMode) return;\n    try {\n      navigator.mediaSession.setActionHandler(action, handler);',
  '  const registerAction = (action, handler) => {\n    nativeActions.set(({ play: "play", pause: "pause", nexttrack: "next", previoustrack: "previous", seekto: "seek" })[action] || action, handler);\n    actionHandlers.set(action, handler);\n    if (isAndroidShell() || nativeRadioMode) return;\n    try {\n      navigator.mediaSession.setActionHandler(action, handler);',
  "native transport handler routing");
media = once(media,
  '  state.subscribe("playbackStateChanged", (isPlaying) => {\n    if (!nativeRadioMode) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";\n  });',
  '  state.subscribe("playbackStateChanged", (isPlaying) => {\n    if (isAndroidShell()) { publishNative(state.currentSong, isPlaying); return; }\n    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";\n  });',
  "native playback state");
media = once(media,
  '  state.subscribe("timeUpdate", ({ currentTime, duration }) => {\n    if (!nativeRadioMode && "setPositionState" in navigator.mediaSession',
  '  state.subscribe("timeUpdate", ({ currentTime, duration }) => {\n    if (isAndroidShell() || nativeRadioMode) return;\n    if ("setPositionState" in navigator.mediaSession',
  "native position suppression");
media = once(media,
  '  if (!nativeRadioMode && state.currentSong) {\n    updateMetadata(state.currentSong);\n  }',
  '  if (state.currentSong) {\n    updateMetadata(state.currentSong);\n    if (isAndroidShell()) publishNative(state.currentSong, state.isPlaying);\n  }\n  // ' + marker,
  "native initial metadata");
adapter = once(adapter,
  '    if (message?.version !== 1) return;\n    if (message.type === "radio.state"',
  '    if (message?.version !== 1) return;\n    if (message.type === "music.action") {\n      try { window.dispatchEvent(new CustomEvent("viora-native-music-action", { detail: message })); } catch (_) {}\n    }\n    if (message.type === "radio.state"',
  "native music action delivery");
adapter += "\n// " + marker + "\n";
fs.writeFileSync(mediaPath, media);
fs.writeFileSync(adapterPath, adapter);
const report = { marker, files: ["js/media-session.js", "js/android-radio-adapter.js"], behavior: ["WebAudio remains the only ordinary-music audio owner", "Android native media controls proxy transport actions to existing Media Session handlers", "Radio ownership suppresses ordinary music session publication"] };
fs.writeFileSync(path.join(root, "android-music-media-session-patch-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
