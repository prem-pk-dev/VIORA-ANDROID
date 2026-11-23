#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] || "viora-source");
const marker = "VIORA_INDIA_MUSIC_WATERFALL_V1";
const files = ["js/ui.js","js/audio-engine.js","js/state.js","js/player.js"];
for (const f of files) if (!fs.existsSync(path.join(root,f))) throw new Error("Missing " + f);
const read = f => fs.readFileSync(path.join(root,f),"utf8");
const write = (f,s) => fs.writeFileSync(path.join(root,f),s);
function once(s,a,b,label){const n=s.split(a).length-1;if(n!==1)throw new Error(label+": expected one anchor, got "+n);return s.replace(a,b);}
let ui=read("js/ui.js"), audio=read("js/audio-engine.js"), state=read("js/state.js"), player=read("js/player.js");
if ([ui,audio,state,player].some(s=>s.includes(marker))) throw new Error("India music patch already applied");
fs.copyFileSync(path.resolve("scripts/india-music-engine.js"),path.join(root,"js/india-music-engine.js"));
ui=once(ui,'import { searchYouTubeTracks, youtubePlayer } from "./youtube-player.js";','import { searchYouTubeTracks, youtubePlayer } from "./youtube-player.js";\nimport { indiaMusicEngine } from "./india-music-engine.js";\n// '+marker,"UI engine import");
ui=once(ui,"Search across YouTube Music, Local Library, Artists, and Albums","Search across VIORA Music, Local Library, Artists, and Albums","Search header branding");
ui=once(ui,"Search songs, artists, YouTube tracks, or lyrics...","Search songs, artists, or lyrics...","Search placeholder");
ui=once(ui,"            YouTube Music\n          </button>","            VIORA Music\n          </button>","Search source tab");
ui=once(ui,"                  YouTube Music\n                </h3>\n                <span id=\"yt-loading-indicator\" style=\"font-size:0.8rem;color:var(--color-text-muted);\">Searching YouTube...</span>","                  VIORA Music\n                </h3>\n                <span id=\"yt-loading-indicator\" style=\"font-size:0.8rem;color:var(--color-text-muted);\">Searching music providers...</span>","Search results heading");
ui=once(ui,"Load More YouTube Tracks","Load More Tracks","Load more label");
const start=ui.indexOf("      // 2. Query YouTube Data API");
const end=ui.indexOf("\n    };\n\n    input?.addEventListener",start);
if(start<0||end<0) throw new Error("Could not locate bounded online search block");
const replacement=`      // VIORA India-first waterfall search: JioSaavn -> Piped -> Audius.
      if (activeFilter === "all" || activeFilter === "youtube") {
        const container = document.getElementById("yt-results-container");
        const indicator = document.getElementById("yt-loading-indicator");
        const moreWrap = document.getElementById("yt-load-more-wrap");
        if (!navigator.onLine) {
          if (indicator) indicator.textContent = "Offline — your local library is still available.";
          return;
        }
        try {
          const onlineQuery = [query, selectedLanguage !== "All Indian" ? selectedLanguage : "Indian music", selectedCategory].filter(Boolean).join(" ");\n          const result = await indiaMusicEngine.search(onlineQuery, 20);
          if (indicator) indicator.textContent = result.provider ? "Source: " + result.provider : "No online results";
          if (!result.items.length) {
            if (container) container.innerHTML = '<p style="grid-column:1/-1;color:var(--color-text-muted);">No tracks found. Try another search.</p>';
            return;
          }
          const renderCards = (items) => items.forEach(track => {
            const card = document.createElement("div");
            card.style.cssText = "background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;";
            card.innerHTML = '<div style="width:100%;aspect-ratio:16/9;background:var(--color-bg-surface);overflow:hidden;"><img class="vi-art" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy"></div>' +
              '<div style="padding:12px;display:flex;flex-direction:column;gap:8px;"><strong class="vi-title" style="font-size:.9rem;"></strong>' +
              '<span class="vi-meta" style="font-size:.8rem;color:var(--color-text-muted);"></span>' +
              '<div style="display:flex;gap:8px;"><button class="btn-primary vi-play" style="flex:1;justify-content:center;">▶ Play</button>' +
              '<button class="btn-secondary vi-queue">＋ Queue</button><button class="icon-btn vi-fav">' +
              (state.isFavorite(track.id) ? ICONS.heartFilled : ICONS.heart) + '</button></div></div>';
            const art = card.querySelector(".vi-art");
            if (/^https:\/\//i.test(String(track.artwork || ""))) art.src = track.artwork;
            card.querySelector(".vi-title").textContent = track.title || "Unknown track";
            card.querySelector(".vi-meta").textContent = (track.artist || "Unknown artist") + " · " + (track.sourceProvider || "online");
            const play = () => {
              const index = state.queue.findIndex(x => x.id === track.id);
              if (index >= 0) audioEngine.playTrackAtIndex(index);
              else { state.setQueue([track, ...state.queue], 0); audioEngine.playTrackAtIndex(0); }
            };
            card.querySelector(".vi-play")?.addEventListener("click", play);
            card.querySelector(".vi-queue")?.addEventListener("click", () => { state.addToQueue(track); showToast("Added to queue: " + track.title); });
            card.querySelector(".vi-fav")?.addEventListener("click", e => {
              state.toggleFavorite(track.id);
              e.currentTarget.innerHTML = state.isFavorite(track.id) ? ICONS.heartFilled : ICONS.heart;
            });
            container?.appendChild(card);
          });
          renderCards(result.items);
          if (moreWrap) moreWrap.style.display = "none";
        } catch (err) {
          if (indicator) indicator.textContent = "Online search unavailable. Local music remains available.";
          console.warn("VIORA provider waterfall failed", err);
        }
      }`;
ui=ui.slice(0,start)+replacement+ui.slice(end);
const chipAnchor='        <div id="recent-searches-box" style="margin-bottom:24px;">';
const chips=`        <div id="viora-india-discovery" style="display:flex;flex-direction:column;gap:10px;margin:0 0 18px;">
          <div style="display:flex;gap:7px;overflow-x:auto;padding-bottom:4px;">
            ${["All Indian","Hindi","Punjabi","Tamil","Telugu","Bhojpuri","Haryanvi","Marathi","Bengali"].map(x=>'<button type="button" class="vi-language" data-value="'+x+'" style="white-space:nowrap;padding:6px 12px;border-radius:20px;border:1px solid var(--color-border);background:var(--color-bg-card);color:var(--color-text-primary);">'+x+'</button>').join("")}
          </div>
          <div style="display:flex;gap:7px;overflow-x:auto;padding-bottom:4px;">
            ${["Bollywood Hits","Trending India","Romantic Love","Sad Heartbreak","Hindi Lo-Fi","Party DJ Remix","Devotional Bhakti","90s Retro India","Desi Hip-Hop Rap"].map(x=>'<button type="button" class="vi-category" data-value="'+x+'" style="white-space:nowrap;padding:6px 12px;border-radius:20px;border:1px solid var(--color-border);background:var(--color-bg-card);color:var(--color-text-primary);">'+x+'</button>').join("")}
          </div>
        </div>
`;
ui=once(ui,chipAnchor,chips+chipAnchor,"India language/category chips");
ui=once(ui,'    renderTags();\n\n    document.getElementById("clear-recent-btn")','    renderTags();\n    let selectedLanguage = "All Indian";\n    let selectedCategory = "";\n    document.querySelectorAll(".vi-language").forEach(btn => btn.addEventListener("click", () => { selectedLanguage = btn.dataset.value; document.querySelectorAll(".vi-language").forEach(x => x.classList.toggle("active", x===btn)); doSearch(input.value.trim() || (selectedLanguage === "All Indian" ? "Indian music" : selectedLanguage)); }));\n    document.querySelectorAll(".vi-category").forEach(btn => btn.addEventListener("click", () => { selectedCategory = btn.dataset.value; document.querySelectorAll(".vi-category").forEach(x => x.classList.toggle("active", x===btn)); doSearch(input.value.trim() || selectedCategory); }));\n\n    document.getElementById("clear-recent-btn")',"Wire India discovery chips");
audio=once(audio,'import { playbackAnalytics } from "./playback-analytics.js";','import { playbackAnalytics } from "./playback-analytics.js";\nimport { indiaMusicEngine } from "./india-music-engine.js";\n// '+marker,"Audio engine import");
audio=once(audio,'    const song = state.currentSong;\n    const isYouTube = song && this.isYouTubeSong(song);','    const song = state.currentSong;\n    const isYouTube = song && this.isYouTubeSong(song);',"Audio source selector anchor");
audio=once(audio,'    } else if (song && (song.blobUrl || song.source === "local" || song.isCustom || (song.id && song.id.startsWith("local:")))) {','    } else if (song && song.source === "online" && song.streamUrl) {\n      this.playOnlineTrack(song);\n    } else if (song && (song.blobUrl || song.source === "local" || song.isCustom || (song.id && song.id.startsWith("local:")))) {',"Online audio routing");
const methodAnchor='  play() {\n    this.ensureContext();';
const method=`  playOnlineTrack(song) {
    youtubePlayer.pause();
    this.stopProceduralSynthesizer();
    this.isSynthesized = false;
    if (this.radioAudio) this.radioAudio.pause();
    const audio = this.htmlAudio;
    const token = (this.onlinePlaybackToken || 0) + 1;
    this.onlinePlaybackToken = token;
    this.onlineRecoveryProviders = [song.sourceProvider];
    audio.pause();
    audio.crossOrigin = "anonymous";
    audio.src = song.streamUrl;
    audio.volume = state.isMuted ? 0 : (this.audioCtx && this.sourceNode ? 1 : state.volume);
    audio.load();
    audio.play().then(() => {
      if (token !== this.onlinePlaybackToken) return;
      state.isPlaying = true;
      state.notify("playbackStateChanged", true);
    }).catch(() => this.recoverOnlinePlayback(song, token));
  }

  async recoverOnlinePlayback(song, token) {
    if (token !== this.onlinePlaybackToken || !song || song.source !== "online") return;
    const replacement = await indiaMusicEngine.recover(song, this.onlineRecoveryProviders || []);
    if (!replacement || token !== this.onlinePlaybackToken) {
      state.isPlaying = false;
      state.notify("playbackStateChanged", false);
      showToast("This stream failed and no fallback provider had a playable match.", "error");
      return;
    }
    this.onlineRecoveryProviders = [...(this.onlineRecoveryProviders || []), replacement.sourceProvider];
    Object.assign(song, replacement);
    state.notify("songChanged", song);
    const audio = this.htmlAudio;
    audio.src = song.streamUrl;
    audio.load();
    try {
      await audio.play();
      if (token === this.onlinePlaybackToken) {
        state.isPlaying = true;
        state.notify("playbackStateChanged", true);
        showToast("Recovered playback via " + song.sourceProvider);
      }
    } catch (_) {
      this.recoverOnlinePlayback(song, token);
    }
  }

`;
audio=once(audio,methodAnchor,method+methodAnchor,"Online stream playback methods");
audio=once(audio,'    this.htmlAudio.addEventListener("error", (e) => {\n      if (state.isStream || state.currentSong?.source === "radio") return;','    this.htmlAudio.addEventListener("error", (e) => {\n      if (state.currentSong?.source === "online") { this.recoverOnlinePlayback(state.currentSong, this.onlinePlaybackToken); return; }\n      if (state.isStream || state.currentSong?.source === "radio") return;',"Online stream error recovery");
state=once(state,'    const isRealTrackId = (id) => localTrackIds.has(id) ||\n      (typeof id === "string" && id.startsWith("youtube:"));','    const isRealTrackId = (id) => localTrackIds.has(id) ||\n      (typeof id === "string" && (id.startsWith("youtube:") || id.startsWith("online:")));',"Persist online favorites/history");
state=once(state,'          track.source === "youtube" ||\n          (typeof track.id === "string" && track.id.startsWith("youtube:"))','          track.source === "youtube" ||\n          track.source === "online" ||\n          (typeof track.id === "string" && (track.id.startsWith("youtube:") || track.id.startsWith("online:")))','Persist online queue");
player=once(player,'      } else if (isYouTube) {','      } else if (isYouTube) {',"Player badge anchor");
player=once(player,'      } else if (isLocal) {','      } else if (song.source === "online") {\n        const provider = String(song.sourceProvider || "online").toUpperCase();\n        sourceBadge = `<span class="badge-pill" style="background:rgba(34,197,94,.16);color:#22c55e;border:1px solid rgba(34,197,94,.3);">${provider}</span>`;\n      } else if (isLocal) {','Online provider badge');
write("js/ui.js",ui);write("js/audio-engine.js",audio);write("js/state.js",state);write("js/player.js",player);
const report={marker,files:["js/india-music-engine.js","js/ui.js","js/audio-engine.js","js/state.js","js/player.js"],providers:["JioSaavn","Piped","Audius"],timeoutMs:5000,notes:["Local IndexedDB/blob playback branch is preserved","YouTube video-mode implementation remains for legacy video features","Search waterfall and stream recovery require device-side live-provider validation"]};
fs.writeFileSync(path.join(root,"android-india-music-patch-report.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
