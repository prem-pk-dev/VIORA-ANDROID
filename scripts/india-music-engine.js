const PROVIDERS = ["jiosaavn", "piped", "audius"];
const PIPED_INSTANCE_LIST = "https://piped-instances.kavin.rocks/";
const PIPED_FALLBACK = "https://pipedapi.adminforge.de";
const AUDIUS_DISCOVERY = "https://api.audius.co";
const AUDIUS_FALLBACK = "https://discoveryprovider.audius.co";
const APP_NAME = "VIORA";

function withTimeout(url, options = {}, ms = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
function text(value, fallback = "") { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function duration(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function bestSaavnUrl(list) {
  if (!Array.isArray(list)) return "";
  const usable = list.map(x => ({ url: x?.url || x?.link, q: parseInt(String(x?.quality || x?.bitrate || "0").replace(/[^0-9]/g, ""), 10) || 0 }))
    .filter(x => typeof x.url === "string" && /^https?:/i.test(x.url));
  usable.sort((a,b) => b.q-a.q);
  return usable[0]?.url || "";
}
function normalizeSaavn(item) {
  const id = String(item?.id || item?.songId || "");
  const streamUrl = bestSaavnUrl(item?.downloadUrl || item?.download_url);
  if (!id || !streamUrl) return null;
  return { id: "online:jiosaavn:" + id, title: text(item.name || item.title, "Unknown track"),
    artist: text(item.primaryArtists || item.artist || item.singers, "Unknown artist"),
    duration: duration(item.duration), artwork: text(item.image?.[2]?.url || item.image?.[1]?.url || item.image?.[0]?.url || item.image, ""),
    streamUrl, source: "online", sourceProvider: "jiosaavn", format: "STREAM" };
}
function normalizePiped(item, stream) {
  const id = text(item?.id || item?.url);
  const streams = Array.isArray(stream?.audioStreams) ? stream.audioStreams : [];
  const audio = streams.filter(x => x?.url && !x.videoOnly && /^https?:/i.test(x.url))
    .sort((a,b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0))[0];
  if (!id || !audio) return null;
  return { id: "online:piped:" + id, title: text(item.title, "Unknown track"),
    artist: text(item.uploader || item.uploaderName, "Unknown artist"), duration: duration(item.duration),
    artwork: text(item.thumbnail, ""), streamUrl: audio.url, source: "online", sourceProvider: "piped",
    format: "STREAM", bitrate: audio.bitrate || "" };
}
function normalizeAudius(item, host) {
  const id = String(item?.id || "");
  if (!id) return null;
  const artwork = item.artwork?.["480x480"] || item.artwork?.["150x150"] || "";
  return { id: "online:audius:" + id, title: text(item.title, "Unknown track"),
    artist: text(item.user?.name, "Unknown artist"), duration: duration(item.duration), artwork,
    streamUrl: host.replace(/\/$/, "") + "/v1/tracks/" + encodeURIComponent(id) + "/stream?app_name=" + APP_NAME,
    source: "online", sourceProvider: "audius", format: "STREAM" };
}

class IndiaMusicEngine {
  constructor() { this.pipedInstances = null; this.audiusHost = null; }
  async json(url, ms = 5000) {
    const response = await withTimeout(url, { headers: { Accept: "application/json" } }, ms);
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }
  async saavn(query, limit) {
    const data = await this.json("https://saavn.dev/api/search/songs?query=" + encodeURIComponent(query) + "&limit=" + limit);
    const items = data?.data?.results || data?.results || data?.data || [];
    return (Array.isArray(items) ? items : []).map(normalizeSaavn).filter(Boolean);
  }
  async getPipedInstances() {
    if (this.pipedInstances?.length) return this.pipedInstances;
    try {
      const data = await this.json(PIPED_INSTANCE_LIST);
      const rows = Array.isArray(data) ? data : (data?.instances || []);
      this.pipedInstances = rows.map(x => typeof x === "string" ? x : x?.api_url || x?.apiUrl)
        .filter(x => typeof x === "string" && /^https:\/\//i.test(x))
        .map(x => x.replace(/\/$/, "")).slice(0, 8);
    } catch (_) { this.pipedInstances = []; }
    if (!this.pipedInstances.length) this.pipedInstances = [PIPED_FALLBACK];
    return this.pipedInstances;
  }
  async piped(query, limit) {
    const instances = await this.getPipedInstances();
    let lastError;
    for (const host of instances) {
      try {
        const data = await this.json(host + "/search?q=" + encodeURIComponent(query) + "&filter=music_songs");
        const rows = Array.isArray(data) ? data : (data?.items || []);
        const results = [];
        for (const item of rows.slice(0, limit)) {
          if (!item?.id) continue;
          try {
            const stream = await this.json(host + "/streams/" + encodeURIComponent(item.id));
            const normalized = normalizePiped(item, stream);
            if (normalized) results.push(normalized);
          } catch (_) {}
        }
        if (results.length) return results;
      } catch (e) { lastError = e; }
    }
    if (lastError) throw lastError;
    return [];
  }
  async getAudiusHost() {
    if (this.audiusHost) return this.audiusHost;
    try {
      const data = await this.json("https://api.audius.co");
      const hosts = data?.data || [];
      this.audiusHost = hosts.find(x => typeof x === "string") || AUDIUS_FALLBACK;
    } catch (_) { this.audiusHost = AUDIUS_FALLBACK; }
    return this.audiusHost.replace(/\/$/, "");
  }
  async audius(query, limit) {
    const discovered = await this.getAudiusHost();
    const hosts = [...new Set([discovered, AUDIUS_FALLBACK])];
    let lastError;
    for (const host of hosts) {
      try {
        const data = await this.json(host + "/v1/tracks/search?query=" + encodeURIComponent(query) + "&app_name=" + APP_NAME);
        const rows = data?.data || [];
        const items = rows.slice(0, limit).map(x => normalizeAudius(x, host)).filter(Boolean);
        if (items.length) return items;
      } catch (e) { lastError = e; }
    }
    if (lastError) throw lastError;
    return [];
  }
  async searchProvider(provider, query, limit) {
    if (provider === "jiosaavn") return this.saavn(query, limit);
    if (provider === "piped") return this.piped(query, limit);
    if (provider === "audius") return this.audius(query, limit);
    return [];
  }
  async search(query, limit = 20) {
    const q = text(query);
    if (!q) return { items: [], provider: null, errors: [] };
    const errors = [];
    for (const provider of PROVIDERS) {
      try {
        const items = await this.searchProvider(provider, q, limit);
        if (items.length) return { items, provider, errors };
        errors.push(provider + ":empty");
      } catch (e) { errors.push(provider + ":" + String(e?.message || "failed")); }
    }
    return { items: [], provider: null, errors };
  }
  async recover(track, attempted = []) {
    const start = Math.max(0, PROVIDERS.indexOf(track?.sourceProvider));
    const query = [track?.title, track?.artist].filter(Boolean).join(" ");
    for (const provider of PROVIDERS.slice(start + 1)) {
      if (attempted.includes(provider)) continue;
      try {
        const items = await this.searchProvider(provider, query, 5);
        if (items.length) return items[0];
      } catch (_) {}
    }
    return null;
  }
}
export const indiaMusicEngine = new IndiaMusicEngine();
