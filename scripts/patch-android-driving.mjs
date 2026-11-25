#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] || "viora-source");
const expansionPath = path.join(root, "js/expansion.js");
const cssPath = path.join(root, "css/expansion.css");
if (!fs.existsSync(expansionPath) || !fs.existsSync(cssPath)) throw new Error("Driving mode source files missing");
let source = fs.readFileSync(expansionPath, "utf8");
let css = fs.readFileSync(cssPath, "utf8");
const marker = "VIORA_ANDROID_DRIVING_ASSISTANT_V1";
if (source.includes(marker) || fs.existsSync(path.join(root, "js/android-driving-voice.js"))) throw new Error("Driving assistant patch already applied");
function once(input, oldText, newText, label) {
  const count = input.split(oldText).length - 1;
  if (count !== 1) throw new Error(label + ": expected one exact anchor, found " + count);
  return input.replace(oldText, newText);
}
source = once(source, "function renderDrivingMode() {", '// VIORA_ANDROID_DRIVING_ASSISTANT_V1\nimport "./android-driving-voice.js";\nlet vioraDrivingLanguage = "en-IN";\n\nfunction renderDrivingMode() {', "native voice adapter import");
const tick = String.fromCharCode(96);
const start = source.indexOf("  overlay.innerHTML = " + tick);
const end = source.indexOf(tick + ";", start);
if (start < 0 || end < 0) throw new Error("Driving overlay markup bounds missing");
const markup = [
"  overlay.innerHTML = " + tick,
"    <div class=\"viora-driving-top\">",
"      <div><span class=\"viora-driving-kicker\">VIORA • DRIVE MODE</span><p class=\"viora-driving-subtitle\">Simple controls. Eyes on the road.</p></div>",
"      <button type=\"button\" class=\"viora-exp-icon-btn\" id=\"viora-driving-close\" aria-label=\"Close driving mode\">✕</button>",
"    </div>",
"    <div class=\"viora-driving-now\">",
"      <div class=\"viora-driving-art\"><span class=\"viora-driving-art-placeholder\">♫</span><img id=\"viora-driving-artwork\" alt=\"\" hidden></div>",
"      <div class=\"viora-driving-track\"><span class=\"viora-driving-eyebrow\">NOW PLAYING</span><strong id=\"viora-driving-title\">Nothing playing</strong><span id=\"viora-driving-artist\">Choose a track to begin</span><span class=\"viora-driving-live-state\" id=\"viora-driving-playback-state\">READY</span></div>",
"    </div>",
"    <div class=\"viora-driving-controls\">",
"      <button type=\"button\" id=\"viora-driving-prev\" aria-label=\"Previous track\">⏮</button>",
"      <button type=\"button\" id=\"viora-driving-play\" class=\"viora-driving-main\" aria-label=\"Play or pause\">▶</button>",
"      <button type=\"button\" id=\"viora-driving-next\" aria-label=\"Next track\">⏭</button>",
"    </div>",
"    <section class=\"viora-driving-assistant\">",
"      <div class=\"viora-driving-assistant-heading\"><div><strong>VIORA Voice Assistant</strong><span>Hands-free playback controls</span></div><button type=\"button\" id=\"viora-driving-language\" class=\"viora-driving-language\">EN • हिंदी</button><span class=\"viora-driving-mic-icon\">🎙</span></div>",
"      <div class=\"viora-driving-voice-status\" id=\"viora-driving-voice-status\" aria-live=\"polite\">Voice control is ready</div>",
"      <button type=\"button\" id=\"viora-driving-voice\" class=\"viora-exp-btn viora-exp-btn-secondary\">Start voice control</button>",
"      <div class=\"viora-driving-command-hints\"><span>“Play”</span><span>“Pause”</span><span>“Next song”</span><span>“Previous”</span><span>“घर खोलो”</span></div>",
"    </section>",
"    <p class=\"viora-driving-note\">Use voice control only when safe. Keep your attention on the road.</p>",
"  " + tick + ";"
].join("\n");
source = source.slice(0, start) + markup + source.slice(end + 2);
source = once(source,
'  overlay.querySelector("#viora-driving-voice").addEventListener("click", startVoiceControl);',
'  overlay.querySelector("#viora-driving-voice").addEventListener("click", startVoiceControl);\n  overlay.querySelector("#viora-driving-language")?.addEventListener("click", event => {\n    vioraDrivingLanguage = vioraDrivingLanguage === "en-IN" ? "hi-IN" : "en-IN";\n    event.currentTarget.textContent = vioraDrivingLanguage === "en-IN" ? "EN • हिंदी" : "हिंदी • EN";\n    const status = document.getElementById("viora-driving-voice-status");\n    if (status) status.textContent = "Voice language: " + (vioraDrivingLanguage === "en-IN" ? "English (India)" : "हिंदी");\n  });',
"Driving voice language selector");
source = once(source,
'  recognition = new SpeechRecognition();\n  recognition.lang = "en-IN";',
'  recognition = new SpeechRecognition();\n  recognition.lang = vioraDrivingLanguage;',
"Driving voice recognition language");
const oldUpdate = [
"  const updateTrack = () => {",
"    const song = state.currentSong;",
"    const title = document.getElementById(\"viora-driving-title\");",
"    const artist = document.getElementById(\"viora-driving-artist\");",
"    const play = document.getElementById(\"viora-driving-play\");",
"    if (title) title.textContent = song?.title || \"Nothing playing\";",
"    if (artist) artist.textContent = song?.artist || \"Choose a track to begin\";",
"    if (play) play.textContent = state.isPlaying ? \"Ⅱ\" : \"▶\";",
"  };"
].join("\n");
const newUpdate = [
"  const updateTrack = () => {",
"    const song = state.currentSong;",
"    const title = document.getElementById(\"viora-driving-title\");",
"    const artist = document.getElementById(\"viora-driving-artist\");",
"    const play = document.getElementById(\"viora-driving-play\");",
"    const artwork = document.getElementById(\"viora-driving-artwork\");",
"    const placeholder = overlay.querySelector(\".viora-driving-art-placeholder\");",
"    const playback = document.getElementById(\"viora-driving-playback-state\");",
"    if (title) title.textContent = song?.title || \"Nothing playing\";",
"    if (artist) artist.textContent = song?.artist || \"Choose a track to begin\";",
"    if (play) play.textContent = state.isPlaying ? \"Ⅱ\" : \"▶\";",
"    const artUrl = song?.artwork || song?.artworkUrl || \"\";",
"    if (artwork) { if (String(artUrl).startsWith(\"https://\")) { artwork.src = artUrl; artwork.hidden = false; if (placeholder) placeholder.hidden = true; } else { artwork.removeAttribute(\"src\"); artwork.hidden = true; if (placeholder) placeholder.hidden = false; } }",
"    if (playback) playback.textContent = state.isPlaying ? \"NOW PLAYING\" : (song ? \"PAUSED\" : \"READY\");",
"  };"
].join("\n");
source = once(source, oldUpdate, newUpdate, "Driving track and artwork sync");
source = once(source,
'  overlay.querySelector("#viora-driving-close").addEventListener("click", () => {\n    unsubscribeSong();',
'  overlay.querySelector("#viora-driving-close").addEventListener("click", () => {\n    if (recognition) { recognition.stop(); recognition = null; }\n    unsubscribeSong();',
"Stop voice recognizer on overlay close");
const oldCommands = [
'    if (/\\b(play|resume|start)\\b/.test(command)) audioEngine.play();',
'    else if (/\\b(pause|stop)\\b/.test(command)) audioEngine.pause();',
'    else if (/\\b(next|skip)\\b/.test(command)) audioEngine.nextTrack();',
'    else if (/\\b(previous|back)\\b/.test(command)) audioEngine.prevTrack();',
'    else if (command.includes("open library")) window.location.hash = "#/local";',
'    else if (command.includes("open home")) window.location.hash = "#/";',
'    else if (command.includes("open search")) window.location.hash = "#/search";',
'    else showToast(`Command not recognized: ${command}`);'
].join("\n");
const newCommands = [
'    const status = document.getElementById("viora-driving-voice-status");',
'    const voiceButton = document.getElementById("viora-driving-voice");',
'    if (/\\b(play|resume|start)\\b|चलाओ|प्ले|शुरू/.test(command)) audioEngine.play();',
'    else if (/\\b(pause|stop)\\b|रोक|बंद करो/.test(command)) audioEngine.pause();',
'    else if (/\\b(next|skip)\\b|अगला|नेक्स्ट/.test(command)) audioEngine.nextTrack();',
'    else if (/\\b(previous|back)\\b|पिछला|पीछे/.test(command)) audioEngine.prevTrack();',
'    else if (command.includes("open library") || command.includes("लाइब्रेरी खोलो")) window.location.hash = "#/local";',
'    else if (command.includes("open home") || command.includes("घर खोलो")) window.location.hash = "#/";',
'    else if (command.includes("open search") || command.includes("सर्च खोलो")) window.location.hash = "#/search";',
'    else showToast("Command not recognized: " + command);',
'    if (status) status.textContent = "Heard: " + command;',
'    if (voiceButton) voiceButton.textContent = "Start voice control";'
].join("\n");
source = once(source, oldCommands, newCommands, "English and Hindi voice command handling");
source = once(source,
'  current.onerror = (event) => {\n    showToast(event.error === "not-allowed" ? "Microphone permission was denied" : "Voice control could not start");',
'  current.onerror = (event) => {\n    const status = document.getElementById("viora-driving-voice-status");\n    const voiceButton = document.getElementById("viora-driving-voice");\n    if (status) status.textContent = event.error === "not-allowed" ? "Microphone permission is required" : "Voice service unavailable — try again";\n    if (voiceButton) voiceButton.textContent = "Start voice control";\n    showToast(event.error === "not-allowed" ? "Microphone permission was denied" : "Voice control could not start");',
"Voice error status");
source = once(source,
'  current.onend = () => { if (recognition === current) recognition = null; };',
'  current.onend = () => { if (recognition === current) recognition = null; const b = document.getElementById("viora-driving-voice"); if (b) b.textContent = "Start voice control"; };',
"Voice end state");
source = once(source,
'    current.start();\n    showToast("Listening for a VIORA command…");',
'    current.start();\n    const status = document.getElementById("viora-driving-voice-status");\n    const voiceButton = document.getElementById("viora-driving-voice");\n    if (status) status.textContent = "Listening… speak a short command";\n    if (voiceButton) voiceButton.textContent = "Stop listening";\n    showToast("Listening for a VIORA command…");',
"Voice listening UI state");
source = once(source,
'    recognition = null;\n    showToast("Voice control is already starting");',
'    recognition = null;\n    const status = document.getElementById("viora-driving-voice-status");\n    if (status) status.textContent = "Could not start voice control";\n    showToast("Voice control is already starting");',
"Voice start error UI state");
source = once(source,
'  <strong>Driving Mode</strong><p>Large touch controls for safer, simpler playback access.</p>',
'  <strong>Driving Mode</strong><p>Focused full-screen player with large controls and a native Android voice assistant.</p>',
"Driving mode description");
source = once(source,
'  <strong>Voice Control</strong><p>Play, pause, next, previous, and open app sections by voice.</p>',
'  <strong>Voice Assistant</strong><p>Use English or Hindi voice commands for playback and navigation.</p>',
"Voice assistant description");
fs.writeFileSync(expansionPath, source);
fs.writeFileSync(path.join(root, "js/android-driving-voice.js"), "// Native WebView speech-recognition adapter. The Android bridge owns microphone permission.\nif (window.VioraVoice) {\n  class VioraNativeSpeechRecognition {\n    constructor() {\n      this.lang = \"en-IN\";\n      this.continuous = false;\n      this.interimResults = false;\n      this.maxAlternatives = 1;\n      this.onresult = null;\n      this.onerror = null;\n      this.onend = null;\n      this.onstart = null;\n      this._onResult = event => {\n        const transcript = event.detail?.transcript || \"\";\n        if (transcript && this.onresult) this.onresult({ results: [[{ transcript }]], resultIndex: 0 });\n      };\n      this._onError = event => { if (this.onerror) this.onerror({ error: event.detail?.error || \"audio\" }); };\n      this._onState = event => { if (event.detail?.state === \"listening\" && this.onstart) this.onstart(); };\n      this._onEnd = () => {\n        window.removeEventListener(\"viora-native-speech-result\", this._onResult);\n        window.removeEventListener(\"viora-native-speech-error\", this._onError);\n        window.removeEventListener(\"viora-native-speech-state\", this._onState);\n        window.removeEventListener(\"viora-native-speech-end\", this._onEnd);\n        if (this.onend) this.onend();\n      };\n    }\n    start() {\n      window.addEventListener(\"viora-native-speech-result\", this._onResult);\n      window.addEventListener(\"viora-native-speech-error\", this._onError);\n      window.addEventListener(\"viora-native-speech-state\", this._onState);\n      window.addEventListener(\"viora-native-speech-end\", this._onEnd);\n      try {\n        if (!window.VioraVoice.isAvailable()) throw new Error(\"service-not-available\");\n        window.VioraVoice.startListening(this.lang || \"en-IN\");\n      } catch (error) {\n        if (this.onerror) this.onerror({ error: error.message || \"service-not-available\" });\n        this._onEnd();\n      }\n    }\n    stop() { try { window.VioraVoice.stopListening(); } catch (_) { this._onEnd(); } }\n    abort() { this.stop(); }\n  }\n  window.SpeechRecognition = VioraNativeSpeechRecognition;\n  window.webkitSpeechRecognition = VioraNativeSpeechRecognition;\n}");
css += `
/* VIORA_ANDROID_DRIVING_ASSISTANT_V1 — clearer hierarchy, artwork and voice assistant states */
.viora-driving-overlay { justify-content:flex-start !important; overflow-y:auto; gap:clamp(20px,4vh,34px) !important; padding-left:max(22px,env(safe-area-inset-left,0px)); padding-right:max(22px,env(safe-area-inset-right,0px)); background:radial-gradient(ellipse at 50% 16%,rgba(0,220,255,.18),transparent 42%),linear-gradient(155deg,#080d1c 0%,#0b1426 54%,#040710 100%) !important; }
.viora-driving-top { min-height:58px; }
.viora-driving-kicker { display:inline-flex; align-items:center; gap:8px; font-size:.7rem !important; letter-spacing:.16em !important; }
.viora-driving-kicker:before { content:""; width:8px; height:8px; border-radius:50%; background:#32e6b5; box-shadow:0 0 14px #32e6b5; }
.viora-driving-subtitle { color:rgba(255,255,255,.55); font-size:.76rem; margin-top:5px; }
.viora-driving-now { flex-direction:column; text-align:center; gap:18px !important; width:min(100%,520px) !important; margin:0 auto !important; }
.viora-driving-art { position:relative; width:min(58vw,230px) !important; border-radius:26px !important; overflow:hidden; box-shadow:0 24px 70px rgba(0,0,0,.48),0 0 0 1px rgba(255,255,255,.12); background:linear-gradient(135deg,#00d9f5,#7467ff) !important; }
.viora-driving-art img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.viora-driving-art-placeholder { font-size:4rem; }
.viora-driving-track { justify-items:center; gap:7px !important; width:100%; }
.viora-driving-eyebrow { color:#53dff4 !important; font-size:.64rem !important; font-weight:900; letter-spacing:.18em; }
.viora-driving-track strong { font-size:clamp(1.25rem,5vw,1.8rem) !important; line-height:1.2; }
.viora-driving-track span { font-size:.9rem !important; }
.viora-driving-live-state { margin-top:4px; padding:5px 11px; border-radius:999px; background:rgba(83,223,244,.11); color:#53dff4 !important; font-size:.62rem !important; font-weight:900; letter-spacing:.12em; }
.viora-driving-controls { gap:clamp(22px,7vw,42px) !important; }
.viora-driving-controls button { box-shadow:0 10px 28px rgba(0,0,0,.24); border-color:rgba(255,255,255,.12) !important; }
.viora-driving-controls .viora-driving-main { box-shadow:0 12px 36px rgba(0,220,255,.26); }
.viora-driving-assistant { width:min(100%,520px); margin:0 auto; padding:16px; border:1px solid rgba(83,223,244,.2); border-radius:20px; background:linear-gradient(145deg,rgba(18,33,55,.94),rgba(10,18,32,.94)); box-shadow:0 18px 48px rgba(0,0,0,.22); }
.viora-driving-assistant-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }\n.viora-driving-language { padding:8px 10px; border-radius:999px; border:1px solid rgba(83,223,244,.3); background:rgba(83,223,244,.1); color:#a9eaf3; font-size:.7rem; font-weight:900; white-space:nowrap; }
.viora-driving-assistant-heading > div { display:grid; gap:4px; }
.viora-driving-assistant-heading strong { font-size:1rem; }
.viora-driving-assistant-heading span { color:rgba(255,255,255,.56); font-size:.75rem; }
.viora-driving-mic-icon { display:grid; place-items:center; width:42px; height:42px; border-radius:14px; background:rgba(83,223,244,.12); font-size:1.25rem; }
.viora-driving-voice-status { min-height:36px; margin:12px 0 8px; padding:9px 11px; border-radius:10px; background:rgba(255,255,255,.055); color:#a9eaf3; font-size:.78rem; }
.viora-driving-assistant > #viora-driving-voice { width:100% !important; min-height:54px !important; border:1px solid rgba(83,223,244,.28) !important; background:linear-gradient(90deg,#00bcd4,#5479ff) !important; color:#06111c !important; font-weight:900 !important; }
.viora-driving-command-hints { display:flex; flex-wrap:wrap; justify-content:center; gap:7px; margin-top:12px; }
.viora-driving-command-hints span { padding:6px 9px; border-radius:999px; background:rgba(255,255,255,.07); color:rgba(255,255,255,.74); font-size:.66rem; }
.viora-driving-note { max-width:480px; margin:0 auto; text-align:center; color:rgba(255,255,255,.42) !important; font-size:.68rem !important; }
@media(max-height:720px) { .viora-driving-overlay { gap:14px !important; } .viora-driving-art { width:min(38vw,150px) !important; } .viora-driving-controls button { width:66px; height:66px; } .viora-driving-controls .viora-driving-main { width:82px; height:82px; } }
`;
css = css.replace(/\\n\.viora-driving-language/g, "\n.viora-driving-language");
css += "\n/* Static player gradients; progress values can still update. */\n.player-progress, .progress-bar, .progress-fill, .player-progress-bar, [class*=\"progress-fill\"], [class*=\"progress-gradient\"], .play-btn, .player-play-btn, .play-pause-btn, [class*=\"play-button-gradient\"], [class*=\"play-btn\"] { animation:none !important; background-position:50% 50% !important; }\n";
fs.writeFileSync(cssPath, css);
const report = { marker, files:["js/expansion.js","js/android-driving-voice.js","css/expansion.css"], features:["native Android SpeechRecognizer polyfill for WebView","runtime microphone permission requested only when user starts voice control","English and Hindi playback/navigation commands","track artwork and playback state synchronized","large high-contrast driving controls and assistant panel"] };
fs.writeFileSync(path.join(root,"android-driving-patch-report.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
