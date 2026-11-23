#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "viora-source");
if (!fs.existsSync(root)) throw new Error("PWA checkout not found: " + root);

const rules = [
  ["search-ui", /type\\s*=\\s*["']search["']|placeholder[^\\n]{0,100}search|addEventListener\\s*\\(\\s*["'](?:input|submit|keydown)["']|oninput|onsearch/gi],
  ["search-api", /fetch\\s*\\(|axios\\.(?:get|post)|/api\\/(?:youtube|search)|youtube\\.com\\/results|search\\/songs|search\\/playlists/gi],
  ["youtube-brand", /YouTube Music Play|YouTube Music/gi],
  ["track-model", /youtubeId|videoId|streamUrl|sourceProvider|downloadUrl|perma_url|trackId|duration_ms/gi],
  ["search-query", /searchQuery|searchTerm|query\\s*=|URLSearchParams|encodeURIComponent|debounce/gi],
  ["discovery-ui", /Bollywood Hits|Trending India|Romantic|Heartbreak|Lo-Fi|DJ Remix|Bhakti|90s Retro|Desi Hip-Hop|Punjabi|Bhojpuri|Haryanvi|Marathi|Bengali/gi]
];

const ignored = new Set(["node_modules", "dist", ".git", "coverage", "build"]);
const extensions = new Set([".js", ".mjs", ".cjs", ".ts", ".html", ".css"]);
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
  const lines = fs.readFileSync(file, "utf8").split(/\\r?\\n/);
  for (let index = 0; index < lines.length; index++) {
    for (const [category, pattern] of rules) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[index])) findings.push({
        file: path.relative(root, file).split(path.sep).join("/"),
        line: index + 1,
        category
      });
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
fs.writeFileSync("artifacts/viora-integration-source-audit.json", JSON.stringify(report, null, 2) + "\\n");
console.log("PWA integration source audit: " + files.length + " source files scanned; " + findings.length + " categorized source locations.");
console.log("Report contains file paths, line numbers and category labels only; no source excerpts or credentials.");
