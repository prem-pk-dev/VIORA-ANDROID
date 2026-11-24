#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "viora-driving-fixture-"));
try {
  fs.mkdirSync(path.join(temp, "js"), { recursive: true });
  fs.mkdirSync(path.join(temp, "css"), { recursive: true });
  const expansion = [
    'let recognition = null;',
    'const state = { currentSong: null, isPlaying: false, subscribe: () => () => {} };',
    'const audioEngine = { play(){}, pause(){}, nextTrack(){}, prevTrack(){} };',
    'const showToast = () => {};',
    'function renderDrivingMode() {',
    '  if (document.getElementById("viora-driving-overlay")) return;',
    '  const overlay = document.createElement("section");',
    '  overlay.id = "viora-driving-overlay";',
    '  overlay.className = "viora-driving-overlay";',
    '  overlay.setAttribute("role", "dialog");',
    '  overlay.setAttribute("aria-modal", "true");',
    '  overlay.setAttribute("aria-label", "VIORA Driving Mode");',
    '  overlay.innerHTML = ' + String.fromCharCode(96),
    '    <div class="viora-driving-top">',
    '      <span class="viora-driving-kicker">VIORA • DRIVING MODE</span>',
    '      <button type="button" class="viora-exp-icon-btn" id="viora-driving-close" aria-label="Close driving mode">✕</button>',
    '    </div>',
    '    <div class="viora-driving-now">',
    '      <div class="viora-driving-art" aria-hidden="true">♫</div>',
    '      <div class="viora-driving-track">',
    '        <strong id="viora-driving-title">Nothing playing</strong>',
    '        <span id="viora-driving-artist">Choose a track to begin</span>',
    '      </div>',
    '    </div>',
    '    <div class="viora-driving-controls">',
    '      <button type="button" id="viora-driving-prev" aria-label="Previous track">⏮</button>',
    '      <button type="button" id="viora-driving-play" class="viora-driving-main" aria-label="Play or pause">▶</button>',
    '      <button type="button" id="viora-driving-next" aria-label="Next track">⏭</button>',
    '    </div>',
    '    <p class="viora-driving-note">Use voice commands where supported. Always keep your attention on the road.</p>',
    '    <button type="button" id="viora-driving-voice" class="viora-exp-btn viora-exp-btn-secondary">Start voice control</button>',
    '  ' + String.fromCharCode(96) + ';',
    '  document.body.appendChild(overlay);',
    '  const updateTrack = () => {',
    '    const song = state.currentSong;',
    '    const title = document.getElementById("viora-driving-title");',
    '    const artist = document.getElementById("viora-driving-artist");',
    '    const play = document.getElementById("viora-driving-play");',
    '    if (title) title.textContent = song?.title || "Nothing playing";',
    '    if (artist) artist.textContent = song?.artist || "Choose a track to begin";',
    '    if (play) play.textContent = state.isPlaying ? "Ⅱ" : "▶";',
    '  };',
    '  const unsubscribeSong = state.subscribe("songChanged", updateTrack);',
    '  const unsubscribePlayback = state.subscribe("playbackStateChanged", updateTrack);',
    '  overlay.querySelector("#viora-driving-close").addEventListener("click", () => {',
    '    unsubscribeSong();',
    '    unsubscribePlayback();',
    '    overlay.remove();',
    '  });',
    '  overlay.querySelector("#viora-driving-prev").addEventListener("click", () => audioEngine.prevTrack());',
    '  overlay.querySelector("#viora-driving-next").addEventListener("click", () => audioEngine.nextTrack());',
    '  overlay.querySelector("#viora-driving-play").addEventListener("click", () => {',
    '    if (state.isPlaying) audioEngine.pause(); else audioEngine.play();',
    '  });',
    '  overlay.querySelector("#viora-driving-voice").addEventListener("click", startVoiceControl);',
    '  updateTrack();',
    '  overlay.querySelector("#viora-driving-close").focus();',
    '}',
    'function startVoiceControl() {',
    '  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;',
    '  if (!SpeechRecognition) { showToast("Voice control is not supported by this browser. Try Chrome on Android."); return; }',
    '  if (recognition) { recognition.stop(); recognition = null; showToast("Voice control stopped"); return; }',
    '  recognition = new SpeechRecognition();',
    '  recognition.lang = "en-IN"; recognition.continuous = false; recognition.interimResults = false; recognition.maxAlternatives = 1;',
    '  const current = recognition;',
    '  current.onresult = (event) => {',
    '    const command = (event.results?.[0]?.[0]?.transcript || "").toLowerCase().trim();',
    '    if (/\\b(play|resume|start)\\b/.test(command)) audioEngine.play();',
    '    else if (/\\b(pause|stop)\\b/.test(command)) audioEngine.pause();',
    '    else if (/\\b(next|skip)\\b/.test(command)) audioEngine.nextTrack();',
    '    else if (/\\b(previous|back)\\b/.test(command)) audioEngine.prevTrack();',
    '    else if (command.includes("open library")) window.location.hash = "#/local";',
    '    else if (command.includes("open home")) window.location.hash = "#/";',
    '    else if (command.includes("open search")) window.location.hash = "#/search";',
    '    else showToast(' + String.fromCharCode(96) + 'Command not recognized: ${command}' + String.fromCharCode(96) + ');',
    '    if (recognition === current) recognition = null;',
    '  };',
    '  current.onerror = (event) => {',
    '    showToast(event.error === "not-allowed" ? "Microphone permission was denied" : "Voice control could not start");',
    '    if (recognition === current) recognition = null;',
    '  };',
    '  current.onend = () => { if (recognition === current) recognition = null; };',
    '  try {',
    '    current.start();',
    '    showToast("Listening for a VIORA command…");',
    '  } catch (error) {',
    '    recognition = null;',
    '    showToast("Voice control is already starting");',
    '  }',
    '}',
    'function bindExpansionActions(root) {}',
    'const settingsText = `  <strong>Driving Mode</strong><p>Large touch controls for safer, simpler playback access.</p>  <strong>Voice Control</strong><p>Play, pause, next, previous, and open app sections by voice.</p>`;',
    ''
  ].join("\n");
  fs.writeFileSync(path.join(temp, "js/expansion.js"), expansion);
  fs.writeFileSync(path.join(temp, "css/expansion.css"), ".viora-driving-overlay {}\n");
  execFileSync(process.execPath, ["scripts/patch-android-driving.mjs", temp], { cwd: repoRoot, stdio: "pipe" });
  execFileSync(process.execPath, ["--check", path.join(temp, "js/expansion.js")], { stdio: "pipe" });
  execFileSync(process.execPath, ["--check", path.join(temp, "js/android-driving-voice.js")], { stdio: "pipe" });
  const patched = fs.readFileSync(path.join(temp, "js/expansion.js"), "utf8");
  const css = fs.readFileSync(path.join(temp, "css/expansion.css"), "utf8");
  const voiceAdapter = fs.readFileSync(path.join(temp, "js/android-driving-voice.js"), "utf8");
  if (!patched.includes('id="viora-driving-language"') || !patched.includes('"hi-IN"') || !patched.includes('recognition.lang = vioraDrivingLanguage')) {
    throw new Error("Driving assistant English/Hindi language selector is not wired to SpeechRecognition");
  }
  if (!voiceAdapter.includes("window.VioraVoice.startListening") || !voiceAdapter.includes("viora-native-speech-result") || !voiceAdapter.includes("viora-native-speech-error")) {
    throw new Error("Native Android speech bridge adapter is missing start/result/error wiring");
  }
  if (!patched.includes("VIORA_ANDROID_DRIVING_ASSISTANT_V1") || !patched.includes("घर खोलो") || !css.includes("viora-driving-assistant")) {
    throw new Error("Driving mode patch output missing expected UI/voice features");
  }
  console.log("PASS: driving mode UI, Android speech adapter, Hindi commands and CSS patch fixture");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
