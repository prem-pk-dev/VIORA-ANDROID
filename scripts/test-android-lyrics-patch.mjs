#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "viora-source");
const file = path.join(root, "js/lyrics.js");
if (!fs.existsSync(file)) throw new Error("Missing patched js/lyrics.js");
const source = fs.readFileSync(file, "utf8");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(source.includes("VIORA_ANDROID_LYRICS_IDENTITY_V1"), "Lyrics identity marker missing");
assert(source.includes('state.subscribe("currentSongChanged"'), "Lyrics must subscribe to the real currentSongChanged state event");
assert(!source.includes('state.subscribe("songChanged"'), "Wrong songChanged event subscription detected");
assert(!source.includes("this.customLyricsCache[cleanTitle.toLowerCase()]"), "Unsafe title-only cache read remains");
assert(!source.includes("saveCachedLyrics(cleanTitle.toLowerCase()"), "Unsafe title-only cache write remains");
assert(source.includes("this.lyricsMatchScore(json, song, duration) >= 0"), "Primary API identity validation missing");
assert(source.includes("this.lyricsMatchScore(candidate, song, duration)"), "Fallback API identity validation missing");
assert(source.includes('if (!state.currentSong || state.currentSong.id !== songId) return;'), "Stale async lyrics render guard missing");
assert(source.includes('if (state.currentSong && state.currentSong.id !== songId) return;'), "Stale container render guard missing");

const match = source.match(/  lyricsMatchScore\(record, song, expectedDuration = 0\) \{[\s\S]*?\n  \}/);
assert(match, "Cannot extract lyrics matcher for behavior tests");
const matcher = new Function("cleanTrackTitle", "cleanArtistName", "return (" + match[0].trim() + ");")(
  value => String(value || "").trim(),
  value => String(value || "").trim()
);
const expected = { title: "Kesariya", artist: "Arijit Singh", duration: 240 };
assert(matcher({ trackName: "Kesariya", artistName: "Arijit Singh", duration: 240, syncedLyrics: "[00:01]test" }, expected, 240) >= 0, "Exact title/artist/duration should match");
assert(matcher({ trackName: "Kesariya", artistName: "Other Artist", duration: 240, syncedLyrics: "[00:01]test" }, expected, 240) < 0, "Wrong artist must be rejected");
assert(matcher({ trackName: "Wrong Song", artistName: "Arijit Singh", duration: 240, syncedLyrics: "[00:01]test" }, expected, 240) < 0, "Wrong title must be rejected");
assert(matcher({ trackName: "Kesariya", artistName: "Arijit Singh", duration: 330, syncedLyrics: "[00:01]test" }, expected, 240) < 0, "Incompatible duration must be rejected");
assert(matcher({ trackName: "Kesariya", duration: 240, syncedLyrics: "[00:01]test" }, expected, 240) < 0, "Missing artist must be rejected");

console.log("PASS: lyrics identity matching, wrong-artist/title/duration rejection, real event subscription, unique cache and stale-response guards");
