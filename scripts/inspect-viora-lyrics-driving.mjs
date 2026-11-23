#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "viora-source");
const selected = [
  "js/ui.js", "js/player.js", "js/audio-engine.js", "js/state.js",
  "js/media-session.js", "js/lyrics.js", "js/assistant.js",
  "js/driving-mode.js", "js/voice-assistant.js", "index.html"
];
const patterns = [
  ["lyrics", /lyrics|syncedLyrics|plainLyrics|LRCLIB|\/api\/lyrics|fetchLyrics|loadLyrics/gi],
  ["driving-assistant", /driving.?mode|drive.?mode|assistant|SpeechRecognition|webkitSpeechRecognition|speechSynthesis|microphone|voice.?command/gi],
  ["track-identity", /currentSong|songChanged|setCurrentSong|playTrackAtIndex|track\.title|track\.artist/gi]
];
const report = { schemaVersion: 1, files: [], notes: "Read-only source excerpts for targeted lyrics and driving-assistant bug analysis; no source files modified." };
for (const rel of selected) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const hits = [];
  for (let i=0;i<lines.length;i++) {
    const cats=[];
    for (const [name,re] of patterns) { re.lastIndex=0; if (re.test(lines[i])) cats.push(name); }
    if (cats.length) hits.push({line:i+1,categories:cats});
  }
  const ranges=[];
  for (const hit of hits) {
    const start=Math.max(1,hit.line-5), end=Math.min(lines.length,hit.line+8);
    const last=ranges[ranges.length-1];
    if (last && start<=last.end+2) last.end=Math.max(last.end,end);
    else ranges.push({start,end});
  }
  const excerpts=[];
  let total=0;
  for (const r of ranges) {
    if (total>2400) break;
    const body=lines.slice(r.start-1,r.end).map((line,i)=>String(r.start+i).padStart(5," ")+": "+line).join("\n");
    excerpts.push(body); total += r.end-r.start+1;
  }
  if (hits.length) report.files.push({path:rel,lineCount:lines.length,hits: hits.length,excerpts});
}
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/viora-lyrics-driving-inspection.json",JSON.stringify(report,null,2)+"\n");
console.log("Lyrics/driving inspection: "+report.files.length+" files; "+report.files.reduce((n,f)=>n+f.hits,0)+" matching source lines.");
