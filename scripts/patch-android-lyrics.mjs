#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] || "viora-source");
const file = path.join(root, "js/lyrics.js");
if (!fs.existsSync(file)) throw new Error("Missing js/lyrics.js");
let source = fs.readFileSync(file, "utf8");
const marker = "VIORA_ANDROID_LYRICS_IDENTITY_V1";
if (source.includes(marker)) throw new Error("Lyrics identity patch already applied");
function once(input, oldText, newText, label) {
  const count = input.split(oldText).length - 1;
  if (count !== 1) throw new Error(label + ": expected one exact anchor, found " + count);
  return input.replace(oldText, newText);
}
const helper = [
"  // VIORA_ANDROID_LYRICS_IDENTITY_V1: match LRCLIB metadata to the exact playing track.",
"  lyricsMatchScore(record, song, expectedDuration = 0) {",
"    if (!record || !song) return -1;",
"    const tokens = value => {",
"      const normalized = String(value || \"\").normalize(\"NFD\").replace(/[\\u0300-\\u036f]/g, \"\").toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, \" \").trim();",
"      return new Set(normalized.split(/\\s+/).filter(word => word.length > 1));",
"    };",
"    const expectedTitle = tokens(cleanTrackTitle(song.title));",
"    const actualTitle = tokens(record.trackName || record.name || \"\");",
"    if (!expectedTitle.size || !actualTitle.size) return -1;",
"    const overlap = [...expectedTitle].filter(x => actualTitle.has(x)).length / new Set([...expectedTitle, ...actualTitle]).size;",
"    let score = 0;",
"    if ([...expectedTitle].every(x => actualTitle.has(x)) && [...actualTitle].every(x => expectedTitle.has(x))) score = 100;",
"    else if (overlap >= 0.82) score = 80;",
"    else if (overlap >= 0.70) score = 60;",
"    else return -1;",
"    const expectedArtist = tokens(cleanArtistName(song.artist));",
"    if (expectedArtist.size) {",
"      const actualArtist = tokens(record.artistName || \"\");",
"      if (!actualArtist.size) return -1;",
"      const artistOverlap = [...expectedArtist].filter(x => actualArtist.has(x)).length / new Set([...expectedArtist, ...actualArtist]).size;",
"      if (artistOverlap < 0.50) return -1;",
"      score += artistOverlap >= 0.90 ? 60 : 35;",
"    } else if (overlap < 0.85) return -1;",
"    const recordDuration = Math.round(Number(record.duration || 0));",
"    if (expectedDuration > 0 && recordDuration > 0) {",
"      const diff = Math.abs(expectedDuration - recordDuration);",
"      if (diff > 45) return -1;",
"      if (diff < 15) score += 20; else if (diff < 35) score += 10;",
"    }",
"    if (record.syncedLyrics) score += 5;",
"    return score;",
"  }"
].join("\n");
source = once(source, '  async clientFallbackFetch(cleanTitle, cleanArtist, duration, song) {', helper + '\n\n  async clientFallbackFetch(cleanTitle, cleanArtist, duration, song) {', "lyrics matcher method");
const demoTitleStart = source.indexOf("    const target = cleanTitle.toLowerCase().trim();", source.indexOf("  findMatchingDemoLyrics("));
const demoTitleEnd = source.indexOf("    return null;", demoTitleStart);
if (demoTitleStart < 0 || demoTitleEnd < 0) throw new Error("Demo title-only fallback block not found");
source = source.slice(0, demoTitleStart) + "    // Android: only exact built-in demo IDs may use demo lyrics; title-only matches can be another recording.\n" + source.slice(demoTitleEnd);

source = once(source,
'    // 3. Check custom cache by clean title\n    if (cleanTitle && this.customLyricsCache[cleanTitle.toLowerCase()] && !this.customLyricsCache[cleanTitle.toLowerCase()].notFound && this.customLyricsCache[cleanTitle.toLowerCase()].lines?.length > 0) {\n      return this.customLyricsCache[cleanTitle.toLowerCase()];\n    }',
'',
"Disable ambiguous title-only lyrics cache");
source = once(source,
'          if (json && json.found && (json.syncedLyrics || json.plainLyrics)) {\n            record = json;\n          }',
'          if (json && json.found && (json.syncedLyrics || json.plainLyrics) && this.lyricsMatchScore(json, song, duration) >= 0) {\n            record = json;\n          }',
"Validate API lyrics identity");
source = once(source,
'          this.saveCachedLyrics(songId, lyricsData);\n          if (cleanTitle) {\n            this.saveCachedLyrics(cleanTitle.toLowerCase(), lyricsData);\n          }\n          this.refreshAllLyricsContainers(songId);',
'          this.saveCachedLyrics(songId, lyricsData);\n          this.refreshAllLyricsContainers(songId);',
"Cache lyrics by unique track ID only");
const start = source.indexOf("    for (const q of queries.slice(0, 5)) {", source.indexOf("  async clientFallbackFetch("));
const end = source.indexOf("\n    return null;\n  }", start);
if (start < 0 || end < 0) throw new Error("Client fallback search block not found");
const strictFallback = [
"    let bestRecord = null;",
"    let bestScore = -1;",
"    for (const q of queries.slice(0, 5)) {",
"      try {",
"        const url = \"https://lrclib.net/api/search?q=\" + encodeURIComponent(q);",
"        const res = await fetch(url, { headers: { \"LrcLib-Client\": \"VIORA (Android)\" } });",
"        if (!res.ok) continue;",
"        const data = await res.json();",
"        if (!Array.isArray(data)) continue;",
"        for (const candidate of data) {",
"          if (!candidate || (!candidate.syncedLyrics && !candidate.plainLyrics)) continue;",
"          const score = this.lyricsMatchScore(candidate, song, duration);",
"          if (score > bestScore) { bestScore = score; bestRecord = candidate; }",
"        }",
"      } catch (e) {}",
"    }",
"    return bestRecord;"
].join("\n");
source = source.slice(0, start) + strictFallback + source.slice(end + "\n    return null;".length);
source = once(source,
'  refreshAllLyricsContainers(songId) {\n    this.currentLyricsData = this.getLyricsForSong(songId);',
'  refreshAllLyricsContainers(songId) {\n    if (!state.currentSong || state.currentSong.id !== songId) return;\n    this.currentLyricsData = this.getLyricsForSong(songId);',
"Prevent stale request from replacing current lyrics");
source = once(source,
'  applySearchResult(resultRecord, songId) {\n    if (!resultRecord || !songId) return;',
'  applySearchResult(resultRecord, songId) {\n    if (!resultRecord || !songId) return;\n    const targetSong = state.getSongById(songId);\n    if (!targetSong || this.lyricsMatchScore(resultRecord, targetSong, Math.round(targetSong.duration || 0)) < 0) {\n      showToast("Lyrics do not match the selected track.", "error");\n      return false;\n    }',
"Validate manually selected lyrics");
source = once(source,
'      this.saveCachedLyrics(songId, lyricsData);\n      if (song) {\n        const cleanTitle = cleanTrackTitle(song.title);\n        this.saveCachedLyrics(cleanTitle.toLowerCase(), lyricsData);\n      }\n\n      this.refreshAllLyricsContainers(songId);',
'      this.saveCachedLyrics(songId, lyricsData);\n      this.refreshAllLyricsContainers(songId);',
"Remove title-only cache writes from manual apply");
source = once(source,
'  renderToContainer(container, songId) {\n    if (!container) return;\n    this.containerEl = container;',
'  renderToContainer(container, songId) {\n    if (!container) return;\n    if (state.currentSong && state.currentSong.id !== songId) { container.innerHTML = ""; return; }\n    this.containerEl = container;',
"Block stale lyrics render");
source = once(source,
'    state.subscribe("currentSongChanged", (song) => {\n      if (song) {\n        this.currentSongId = song.id;',
'    state.subscribe("songChanged", (song) => {\n      this.currentSongId = song?.id || null;\n      this.currentLyricsData = null;\n      this.activeLineIndex = -1;\n      if (song) {',
"Track actual playback change event");
fs.writeFileSync(file, source);
const report = { marker, patchedFile: "js/lyrics.js", guarantees: ["No title-only cache reuse across artists or recordings", "LRCLIB candidates must match title, artist and compatible duration", "Manual lyric selection is validated", "Late response for previous track cannot overwrite current lyrics", "Lyrics service follows songChanged"] };
fs.writeFileSync(path.join(root, "android-lyrics-patch-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
