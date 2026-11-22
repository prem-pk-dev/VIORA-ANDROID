#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "viora-source");
if (!fs.existsSync(root)) throw new Error("PWA checkout not found: " + root);

const rules = [
  ["media-session", /navigator\.mediaSession|MediaMetadata|setActionHandler|playbackState/g],
  ["html-audio", /new Audio\s*\(|createElement\s*\(\s*["']audio["']|HTMLAudioElement|\.play\s*\(\)|\.pause\s*\(\)/g],
  ["web-audio", /AudioContext|webkitAudioContext|createMediaElementSource|createBufferSource/g],
  ["blob-url", /URL\.createObjectURL|URL\.revokeObjectURL|blob:/g],
  ["indexeddb", /indexedDB|IDBDatabase|IDBObjectStore|audioBlobs|MusiqLibraryDB/g],
  ["file-import", /showOpenFilePicker|type\s*=\s*["']file["']|\.arrayBuffer\s*\(|FileReader|webkitdirectory/g],
  ["youtube", /YT\.Player|youtube\.com\/embed|youtube-nocookie\.com|IFrame/g],
  ["audio-source", /\.src\s*=|setAttribute\s*\(\s*["']src["']|srcObject/g]
];

const ignored = new Set(["node_modules", "dist", ".git", "coverage", "build"]);
const extensions = new Set([".js", ".mjs", ".cjs", ".ts", ".html"]);
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) walk(path.join(dir, entry.name));
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
}
walk(root);

const findings = [];
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    for (const [category, pattern] of rules) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[index])) {
        findings.push({
          file: path.relative(root, file).split(path.sep).join("/"),
          line: index + 1,
          category
        });
      }
    }
  }
}
const report = {
  schemaVersion: 1,
  sourceCheckout: "temporary read-only CI checkout",
  scannedFileCount: files.length,
  findingsCount: findings.length,
  categories: Object.fromEntries(rules.map(([name]) => [name, findings.filter(x => x.category === name).length])),
  findings
};
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync("artifacts/viora-playback-source-audit.json", JSON.stringify(report, null, 2) + "\n");
console.log("PWA playback source audit: " + files.length + " source files scanned; " + findings.length + " categorized source locations.");
console.log("Report contains file paths, line numbers and category labels only; no source excerpts or credentials.");
