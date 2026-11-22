import { state } from "./state.js";
import { showToast } from "./components.js";

const pending = new Map();
let sequence = 0;
let listening = false;
let nativeRadioActive = false;

function isAndroidShell() {
  try {
    return window.VioraAndroid?.isAndroidApp?.() === true;
  } catch (_) {
    return false;
  }
}

function bridgeAvailable() {
  return typeof window.VioraNative?.postMessage === "function";
}

function attachListener() {
  if (listening || !bridgeAvailable()) return;
  window.VioraNative.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (_) {
      return;
    }

    if (message?.version !== 1) return;
    if (message.type === "radio.state" || message.type === "radio.snapshot") {
      applyNativeState(message);
    }

    if (message.requestId && pending.has(message.requestId)) {
      const entry = pending.get(message.requestId);
      pending.delete(message.requestId);
      clearTimeout(entry.timeout);
      entry.resolve(message);
    }
  });
  listening = true;
}

function send(command, fields = {}) {
  attachListener();
  if (!bridgeAvailable()) return Promise.resolve({ ok: false, errorCode: "BRIDGE_UNAVAILABLE" });

  const requestId = "viora-radio-" + (++sequence);
  const payload = { version: 1, requestId, command, ...fields };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, errorCode: "NATIVE_TIMEOUT" });
    }, 5000);
    pending.set(requestId, { resolve, timeout });
    try {
      window.VioraNative.postMessage(JSON.stringify(payload));
    } catch (_) {
      clearTimeout(timeout);
      pending.delete(requestId);
      resolve({ ok: false, errorCode: "BRIDGE_SEND_FAILED" });
    }
  });
}

function applyNativeState(message) {
  if (message.type === "radio.snapshot") {
    nativeRadioActive = Boolean(message.stationId);
    if (nativeRadioActive && state.currentSong?.source !== "radio") {
      const station = (state.radioStations || []).find((item) => item.id === message.stationId);
      if (station) {
        state.currentStation = station;
        state.currentSong = {
          id: station.id,
          title: station.name,
          artist: station.genre || "Live Internet Radio",
          album: `${station.location || "Online Broadcast"} • ${station.frequency || "Live Stream"}`,
          artwork: station.artwork,
          duration: Infinity,
          isLive: true,
          source: "radio",
          format: "LIVE BROADCAST",
          bitrate: station.bitrate || "128 kbps",
          streamUrl: station.streamUrl,
          frequency: station.frequency || "LIVE",
          genre: station.genre
        };
        state.isStream = true;
        state.notify("songChanged", state.currentSong);
      }
    }
  } else if (message.type === "radio.state") {
    nativeRadioActive = Boolean(message.stationId);
  }

  if (state.currentSong?.source === "radio") {
    state.isPlaying = Boolean(message.isPlaying);
    state.isStream = nativeRadioActive;
    state.duration = Infinity;
    state.notify("playbackStateChanged", state.isPlaying);
    state.notify("timeUpdate", { currentTime: 0, duration: Infinity });
  }

  if (message.errorCode) {
    state.isPlaying = false;
    state.notify("playbackStateChanged", false);
    showToast("Live radio could not be started. Please try another station.", "error");
  }
}

export const androidRadioAdapter = {
  isAndroidShell,
  isAvailable: bridgeAvailable,
  isActive: () => isAndroidShell() && nativeRadioActive,

  async play(station, engine) {
    if (!isAndroidShell()) return false;
    if (!bridgeAvailable()) {
      showToast("This Android WebView does not support secure native radio controls.", "error");
      return false;
    }

    // Release all WebView-owned audio before requesting native ownership.
    engine?.youtubePlayer?.pause?.();
    engine?.stopProceduralSynthesizer?.();
    if (engine) {
      engine.isSynthesized = false;
      engine.htmlAudio.pause();
      engine.htmlAudio.removeAttribute("src");
      engine.radioAudio.pause();
      engine.radioAudio.removeAttribute("src");
    }

    const radioSong = {
      id: station.id,
      title: station.name,
      artist: station.genre || "Live Internet Radio",
      album: `${station.location || "Online Broadcast"} • ${station.frequency || "Live Stream"}`,
      artwork: station.artwork,
      duration: Infinity,
      isLive: true,
      source: "radio",
      format: "LIVE BROADCAST",
      bitrate: station.bitrate || "128 kbps",
      streamUrl: station.streamUrl,
      frequency: station.frequency || "LIVE",
      genre: station.genre
    };

    state.currentSong = radioSong;
    state.isStream = true;
    state.currentStation = station;
    state.isPlaying = false;
    state.currentTime = 0;
    state.duration = Infinity;
    state.addSongToHistory(radioSong);
    state.notify("songChanged", radioSong);
    state.notify("playbackStateChanged", false);

    const response = await send("radio.play", {
      stationId: station.id,
      streamUrl: station.streamUrl,
      title: station.name,
      artist: station.genre || "Live Internet Radio",
      artworkUrl: station.artwork || "",
      bitrate: station.bitrate || "128 kbps"
    });
    if (!response.ok) {
      nativeRadioActive = false;
      state.isPlaying = false;
      state.notify("playbackStateChanged", false);
      showToast("Native radio service could not accept this station.", "error");
      return false;
    }

    nativeRadioActive = true;
    const volume = state.isMuted ? 0 : state.volume;
    await send("radio.setVolume", { volume });
    return true;
  },

  async pause() {
    if (!isAndroidShell()) return false;
    const response = await send("radio.pause");
    if (response.ok) {
      state.isPlaying = false;
      state.notify("playbackStateChanged", false);
    }
    return response.ok === true;
  },

  async resume() {
    if (!isAndroidShell()) return false;
    const response = await send("radio.resume");
    if (response.ok && nativeRadioActive) {
      state.isPlaying = true;
      state.notify("playbackStateChanged", true);
    }
    return response.ok === true;
  },

  async stop() {
    if (!isAndroidShell()) return true;
    const response = await send("radio.stop");
    if (!response.ok) return false;
    nativeRadioActive = false;
    state.isPlaying = false;
    state.isStream = false;
    state.notify("playbackStateChanged", false);
    return true;
  },

  async setVolume(volume) {
    if (!this.isActive()) return false;
    const response = await send("radio.setVolume", { volume: Math.max(0, Math.min(1, volume)) });
    return response.ok === true;
  },

  requestSnapshot() {
    if (isAndroidShell() && bridgeAvailable()) send("radio.getSnapshot");
  }
};

if (isAndroidShell()) {
  // A service may outlive the Activity/WebView. Reconcile its state after the page loads.
  queueMicrotask(() => androidRadioAdapter.requestSnapshot());
}
