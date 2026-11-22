# VIORA Android Playback Architecture

Status: engineering proposal for review and implementation planning. No playback implementation is included in this document.

## Objective

Add reliable Android background playback and system media controls without creating two simultaneous playback engines or silently removing existing VIORA behavior. Preserve the original PWA repository as read-only; Android-specific adaptation belongs in the Android repository and its CI workspace.

## Verified current playback paths

Repository source review confirms three distinct paths:

1. **Standard and local tracks**
   - AudioEngine.htmlAudio is the primary HTML audio element.
   - It is connected to a Web Audio graph when the AudioContext is available.
   - The graph includes preamp, ten EQ filters, bass/treble shelves, stereo panner, compressor, reverb, master gain and analyser.
   - Local tracks may use Blob/object URLs and audio blobs stored in IndexedDB. This is not automatically a durable Android content:// source.

2. **Live radio**
   - Uses a separate AudioEngine.radioAudio HTMLAudio element.
   - Radio is treated as live/non-seekable.
   - It is not routed through the same htmlAudio Web Audio source graph in the inspected code.

3. **YouTube**
   - Uses the YouTube IFrame API/player service.
   - It is not the same audio path as standard/local HTMLAudio playback.
   - YouTube playback restrictions and background behavior must be tested independently; do not promise screen-off playback for this path.

The existing PWA media-session.js registers browser Media Session actions and calls the existing audioEngine methods. The Android shell currently exposes only isAndroidApp() and getAppVersion() through VioraAndroid; there is no native playback service or Media3 dependency yet.

## Recommended target architecture

**One playback owner per source type; no parallel audio for the same item.**

- Android native Media3 service becomes the playback owner for standard direct-audio sources, live radio streams, and Android-native local content sources.
- YouTube remains owned by the existing YouTube IFrame player in WebView. It must never be started simultaneously with the native player.
- The WebView remains the UI/control surface. On Android, an Android-specific adapter in the generated Android build routes supported commands to the native service instead of starting the corresponding HTMLAudio element.
- The PWA source repository remains unchanged. Any Android-only adaptation must be isolated to the Android repository or the CI-generated copy, with deterministic checks that fail if expected patch points are missing.
- Native MediaSession and the foreground playback service expose notification, lock-screen and headset controls. Those controls call the same native playback owner for Media3-backed sources.
- Native playback state is the source of truth for Media3-backed sources. A narrow bridge publishes state changes to the WebView UI. When the WebView is recreated, it requests a complete state snapshot from the service rather than assuming its old JavaScript state is current.

## Source routing contract

| Source type | Playback owner | Notes |
| --- | --- | --- |
| Direct remote audio track | Not currently a verified PWA source | Future capability only; do not use as a production POC or claim it preserves an existing feature |
| Live radio | Media3 service | Live metadata; no arbitrary seek; station next/previous |
| New Android local import | Media3 service | Persisted SAF content:// URI permission; native metadata |
| Existing PWA IndexedDB/Blob local track | Not yet decided | Requires a safe migration/adapter; a Blob URL cannot simply be passed to a service |
| YouTube IFrame track/video | WebView YouTube player | Keep existing player; do not create a second native audio copy |

Do not route a source to Media3 until its URL/URI, metadata, duration/live status, identity, and permission lifetime are known. If a source cannot be resolved safely, report a controlled unsupported/error state; do not start a second fallback player behind the user's back.

## Verified JavaScript source and command mapping — 22 November 2026

This mapping is based on read-only inspection of the current PWA `js/audio-engine.js`, `js/state.js`, `js/media-session.js`, `js/local-library.js`, and `js/storage.js`:

| PWA behavior | Existing owner / API | Integration requirement |
| --- | --- | --- |
| YouTube track | `youtubePlayer` / IFrame; recognized by `source === "youtube"`, `id` prefix `youtube:`, or `youtubeId` | Keep in WebView. Before starting it, stop any native Media3 item; do not duplicate it natively. |
| Live radio | `AudioEngine.radioAudio`; `playRadio(station)` sets `state.currentSong`, `state.currentStation`, `state.isStream` | Has `streamUrl`, station ID/name/artwork/genre; radio is live and not arbitrarily seekable. Existing radio element is separate from the standard Web Audio source graph. |
| Local/custom audio | `AudioEngine.htmlAudio`; track may contain `blobUrl`; bytes in IndexedDB `MusiqLibraryDB` / `audioBlobs` | Not native-service-ready. A temporary Blob URL is not a persistent URI; keep this path in WebView until a safe URI migration exists. |
| Other/non-YouTube/non-radio item | Falls through to local/custom branch only when blob/local markers exist; otherwise no generic direct URL playback branch was found | Treat unknown descriptors as unsupported. Do not guess a URL field or invent a Media3 source. |

Existing Web Media Session handlers call `audioEngine.play()`, `pause()`, `nextTrack()`, `prevTrack()`, and `seek()`. `nextTrack()` and `prevTrack()` contain queue and radio-station logic; `prevTrack()` restarts the current non-radio item when position is over three seconds. The Media Session previous action intentionally has separate previous-item behavior. Preserve this distinction in any Android command mapping.

The current queue state is `state.queue` plus `state.queueIndex`; `setQueue()` persists `queueData`, `queueIndex`, and ID list, then emits `queueChanged`. `songChanged`, `playbackStateChanged`, and `timeUpdate` are used by the existing UI and Media Session. Native-to-WebView synchronization must not silently mutate queue order or trigger a second `play()` call when reflecting a native event.

Current exposed effect state includes ten `eqBands`, `preamp`, `bassBoost`, `stereoWiden`, and `reverb`; the inspected Web Audio graph also has treble shaping, stereo panner, compressor, master gain and analyser. Do not equate the UI setting `stereoWiden` with a native pan control without checking the actual setter implementation. Native effects require an explicit per-control mapping and parity measurements.

### Safe first integration decision

There is no verified existing generic direct-remote-audio source to route into Media3. However, a genuine existing source is available for a narrow proof of concept: **live radio**.

- `AudioEngine.playRadio(station)` builds a real radio track descriptor containing station ID, name, genre, artwork, `streamUrl`, bitrate and live metadata, then plays it through the separate `radioAudio` HTMLAudio element.
- The current radio path is separate from the standard `htmlAudio` Web Audio processing graph. Moving radio to Media3 would therefore not remove the existing ten-band EQ from standard/local tracks; radio currently does not use that graph in the inspected code.
- Radio is explicitly live/non-seekable. The existing app's next/previous radio behavior selects the adjacent station from `state.radioStations` and calls `playRadio()`.
- This makes radio the safest genuine source candidate for a limited native POC, ahead of local music or YouTube. It does not prove stream availability or background behavior; those require actual runtime tests.

Proposed POC scope (not yet implemented):
1. Start one selected existing radio station through a native Media3 `MediaSessionService`; do not start `radioAudio` for that station.
2. Synchronize station metadata and play/pause state with the WebView through the origin-scoped bridge.
3. Verify foreground playback, screen-off playback, notification/lock-screen play-pause, audio focus, headphone unplug, service restart, and Activity/WebView recreation.
4. Keep station next/previous disabled in the native session for this first spike unless the full station catalogue and action synchronization are implemented.
5. Keep YouTube and local/custom tracks entirely on their existing WebView paths during this isolated POC; enforce mutual exclusion so no two audio owners play simultaneously.
6. Define rollback to the existing WebView radio path before rollout.

This radio POC is a scoped native enhancement to an existing source, not a claim that all VIORA playback has migrated. Do not add a generic remote-audio source, local Blob migration, YouTube native playback, or native EQ in the same change.

## Bridge security decision

The current `VioraAndroid` JavaScript interface exposes only `isAndroidApp()` and `getAppVersion()`; these are informational methods, not a privileged playback API. Do not add playback, filesystem, intent, or service-control commands to this unrestricted `addJavascriptInterface` surface.

For future privileged JS/native commands, prefer AndroidX WebKit `WebViewCompat.addWebMessageListener()` with the exact trusted app origin `https://appassets.androidplatform.net` in `allowedOriginRules`, and check `WebViewFeature.WEB_MESSAGE_LISTENER` support before registration. The listener must also verify `isMainFrame`, validate the message schema/version/size, allow-list command names and source types, and reject unknown fields or URL schemes. Do not use wildcard origin rules. If the feature is unavailable on the installed WebView, disable native command integration safely rather than falling back to an unrestricted bridge. The currently pinned `androidx.webkit:webkit:1.12.1` is above the API's 1.3.0 introduction version; runtime feature support still needs device verification.

This follows the AndroidX WebKit API's origin-scoped message listener model. See [WebViewCompat reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat) and [WebView message listener source](https://github.com/androidx/androidx/blob/androidx-main/webkit/webkit/src/main/java/androidx/webkit/WebViewCompat.java).

## Android-only implementation blueprint — radio POC

### Build-time adaptation boundary
The Android workflow already checks out the PWA into a temporary `viora-source/` directory and builds it there. The next implementation should add a version-controlled Android script under `scripts/` that patches only this temporary checkout before `npm run build`. It must never commit, push, or otherwise write to `prem-pk-dev/VILORA`.

The patch script should:
- Require exact unique anchors in `js/audio-engine.js` and fail if any anchor is missing or duplicated.
- Be idempotent: a second invocation must detect the adapter marker and fail or report already-patched, never duplicate code.
- Inject a small Android-only radio adapter and change only the radio branch. YouTube, local/custom audio, standard HTMLAudio/Web Audio, EQ, visualizer and PWA Media Session paths remain untouched.
- Emit a patch report listing each applied anchor and verify the built output contains the adapter marker.
- Run before Vite build in the Android workflow, then bundle the generated dist as it does today.

### Proposed bridge message schema (version 1)
The page-to-native message object is JSON with a strict 16 KiB maximum and exactly these supported command names:
- `radio.play`: `stationId`, `streamUrl`, `title`, `artist`, `artworkUrl`, `bitrate`.
- `radio.pause`: no additional fields.
- `radio.resume`: no additional fields.
- `radio.stop`: no additional fields; clears the current native media item and session metadata.
- `radio.setVolume`: `volume` in [0, 1].
- `radio.getSnapshot`: no additional fields.

Every message includes `version: 1` and a non-empty request ID. Reject unknown keys, command names, missing values, non-HTTPS stream/artwork URLs, credentials in URLs, oversized strings, malformed JSON, and non-main-frame messages. Validate station ID and stream URL against the current station object sent by the Android-generated adapter; do not accept arbitrary web page messages as radio station commands.

Native-to-page events use a separate version-1 event shape:
- `radio.snapshot`: station metadata, `isPlaying`, `isBuffering`, error code, and volume.
- `radio.state`: `isPlaying` and `isBuffering`.
- `radio.error`: bounded error code; no raw exception or URL.
- `radio.stopped`: reason code.

No event is allowed to invoke `playRadio()` or mutate the PWA queue. It updates only the current radio UI state. If the WebView is absent, the service remains independent; on page load, the adapter sends `radio.getSnapshot`.

### Native service ownership and transitions
- On `radio.play`, native code validates the HTTPS URL and station descriptor, stops/clears any prior native item, and starts the MediaSessionService with an explicit action and bounded extras.
- The Android adapter first pauses and clears the WebView `radioAudio` element; only after native acceptance does it mark native radio as owner. If native startup fails, surface a controlled error; do not silently start a second player.
- When the user selects YouTube or local/custom audio, the Android adapter sends `radio.stop` and waits for the native service to confirm stopped/cleared before the existing PWA source starts.
- The first native MediaSession exposes play and pause only. Do not expose seek, previous or next commands in the native session for this spike. The in-app radio station picker may still select another station through a new validated `radio.play` command.
- Native player volume follows the PWA volume/mute state; no independent Android-only volume slider is introduced.
- On Activity/WebView recreation, request the native snapshot. Never store an Activity or WebView reference in the service.

### Media3 API decisions verified against current Android documentation

- Use Media3 **1.11.1** consistently for `media3-exoplayer`, `media3-session`, and `media3-common`. Do not mix versions.
- The service owns one `ExoPlayer` and one `MediaSession`, created in `MediaSessionService.onCreate()`, released in `onDestroy()`, and returned by `onGetSession()`.
- Use the MediaSession callback's connection result to restrict external controller capabilities. For the initial radio POC, retain play/pause and remove player commands for seeking, changing media items, and next/previous navigation. Verify both Android System UI and Bluetooth/headset controllers receive only the intended command set.
- The official Media3 example demonstrates filtering a controller's available player commands by building on the connection result and removing specific `Player.COMMAND_*` entries. Use the API supported by the pinned 1.11.1 version and do not copy an unstable/deprecated callback signature blindly.
- Declare `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, and the service with `android:foregroundServiceType="mediaPlayback"` and the Media3 session service action. The service must be started by a user-initiated radio play action, not automatically at app launch.
- Keep artwork metadata as a validated HTTPS URI; failure to load artwork must not block audio playback. Error reporting to the UI uses bounded error codes, not raw exception messages or stream URLs.
- The installed WebView runtime must report `WEB_MESSAGE_LISTENER` support before the origin-scoped listener is registered. The exact `https://appassets.androidplatform.net` origin rule and `isMainFrame` check remain mandatory.

Official references:
- [Media3 background playback](https://developer.android.com/media/media3/session/background-playback)
- [Media3 player app implementation](https://developer.android.com/media/implement/playback-app)
- [MediaSession callback and command filtering](https://developer.android.com/reference/kotlin/androidx/media3/session/MediaSession.Callback)
- [AndroidX WebViewCompat.addWebMessageListener](https://developer.android.com/reference/androidx/webkit/WebViewCompat)


## JavaScript ↔ native command contract

The Android adapter should use a versioned, allow-listed message schema. The exact bridge method names are not finalized; the following are required semantic operations:

- getSnapshot: obtain active source, item ID, metadata, queue, queue index, play state, position, duration/live flag, volume, playback rate, shuffle and repeat mode.
- setQueue: pass normalized item descriptors and start index; do not pass arbitrary JavaScript objects or executable strings.
- play, pause, next, previous, seekTo, setVolume, setPlaybackRate.
- setRepeatMode, setShuffle.
- setEffects: EQ bands, preamp, bass, treble, pan, compressor and reverb settings, with validated ranges.
- playRadioStation: station identity, stream URL, title, artwork and live metadata.
- playYouTube: explicit source handoff to WebView; native player must be stopped before IFrame playback begins.

Native-to-WebView events should include snapshot, itemChanged, playbackStateChanged, positionChanged, queueChanged, playbackError, audioFocusChanged and serviceUnavailable.

Validation requirements:
- Accept only known command names and bounded JSON payloads.
- Validate URLs and source types; reject javascript:, file:, untrusted local paths and arbitrary origins.
- Never evaluate user-supplied strings as JavaScript.
- Do not expose unrestricted filesystem, network, or Android intents through the JavaScript interface.
- Handle WebView absence: the service must continue to own and report Media3 playback without requiring a live Activity reference.

## Media3 processing and feature parity

Migrating standard/local audio from Web Audio to Media3 is not just a notification change. The native audio pipeline must deliberately preserve supported processing:

- Ten-band EQ (31, 63, 125, 250, 500, 1k, 2k, 4k, 8k, 16kHz).
- Preamp, bass and treble shaping.
- Stereo balance/pan where supported.
- Compression/limiting and reverb.
- Visualizer/analyser data with a bounded update rate and no excessive UI-thread work.
- Playback rate, volume/mute, queue, seek, repeat and shuffle behavior.

Implement these as native Media3 audio processors/effects or an equivalent tested pipeline. Device-wide Android equalizer APIs must not be assumed to work consistently across devices. If an effect cannot be reproduced adequately, document and test the difference before claiming parity.

Radio currently uses a separate HTMLAudio element and is not obviously processed by the standard Web Audio graph. Do not claim that native radio has EQ parity until the actual existing behavior and expected behavior are agreed and tested.

YouTube remains separate. Its existing iframe audio is not automatically routed through the native Media3 effect chain. Do not claim native EQ/visualizer parity for YouTube unless a supported, policy-compliant and technically verified route exists.

## Local library migration risk

The PWA local library can store audio blobs in IndexedDB and use Blob/object URLs. Android Media3 cannot safely consume a transient WebView Blob URL after the WebView is destroyed.

Before native local playback is enabled:
1. Define how an imported item receives a stable VIORA item ID and persistent Android URI.
2. Use the Storage Access Framework with persistable URI permission for new imports.
3. Define a backward-compatible path for existing IndexedDB blobs, including storage quotas, cleanup and restart recovery.
4. Preserve metadata, playlists, queue references and deletion behavior.
5. Verify access after force-stop, device restart and permission revocation.

Do not delete or overwrite the existing PWA IndexedDB library during migration.

## Lifecycle and foreground-service requirements

- Start the foreground playback service only in response to a user-initiated playback action, following the target Android version's foreground-service rules.
- Use the media playback foreground-service type and required manifest declarations for the selected target SDK.
- Handle audio focus, transient focus loss, ducking, noisy-route/headphone unplug, Bluetooth route changes, notification dismissal, task removal, process recreation and service shutdown.
- Persist enough queue and current-item state to restore playback after process recreation.
- Ensure the service can continue while the Activity/WebView is backgrounded or destroyed.
- Do not call WebView APIs from a background thread. Do not make the service depend on an Activity or a retained WebView reference.
- Android 15 edge-to-edge insets remain a separate UI verification item.

## Official Android implementation baseline checked on 22 November 2026

- The AndroidX release page lists Media3 **1.11.1 as the stable release**. Media3 1.12.0-beta01 is newer but pre-release; use stable 1.11.1 for the first proof of concept unless a documented fix requires a later version. Keep all Media3 artifacts on one identical version.
- Android's official background-playback guide recommends keeping both the Player and MediaSession inside a MediaSessionService so playback can continue when the Activity is not foregrounded.
- For a target-SDK-35 media playback foreground service, the manifest/service design must account for the mediaPlayback foreground-service type and the required FOREGROUND_SERVICE and FOREGROUND_SERVICE_MEDIA_PLAYBACK permissions. Confirm the complete current Android requirements before implementation.
- The MediaSessionService lifecycle and notification are tied to the actual Player/session state. A service with no real player, or a fake session merely forwarding to a WebView, does not satisfy the architecture requirement.
- The recommended implementation is therefore a real native player for the source types explicitly assigned to Media3, not a notification-only wrapper around the existing WebView.

Official references:
- [AndroidX Media3 release versions](https://developer.android.com/jetpack/androidx/releases/media3)
- [MediaSessionService API](https://developer.android.com/reference/androidx/media3/session/MediaSessionService)
- [Background playback with MediaSessionService](https://developer.android.com/media/media3/session/background-playback)

## Safe implementation phases

1. **Contract and source model:** finalize source descriptors, item IDs, queue serialization, native state model, error handling and local-URI strategy.
2. **Native player spike:** implement a small isolated Media3 proof of concept for one direct remote audio item only. Test foreground/background, lock screen, audio focus and process recreation before integrating with the app.
3. **Android-only adapter:** route one standard audio source through Media3 in the generated Android build; prove HTMLAudio is not also playing.
4. **Queue and controls:** add queue, next/previous, seek, repeat, shuffle, metadata and notification actions; verify state round-trips.
5. **Effects:** port the existing processing chain and visualizer with measurable behavior tests.
6. **Radio:** add live stream routing and station controls.
7. **Local library:** implement persistent URI imports and a safe existing-blob migration.
8. **YouTube handoff:** enforce mutual exclusion and test foreground behavior; document platform restrictions.
9. **Regression and device matrix:** test all routes, app lifecycle, screen lock, headset/Bluetooth, offline/network errors, long playback, low-memory recovery and multiple Android versions.

Each phase must have an explicit rollback path and acceptance evidence. Do not bundle all phases into one unreviewed patch.

## Acceptance gates

- [ ] No duplicate audio or overlapping playback when switching source types.
- [ ] Standard tracks continue after screen lock and app backgrounding.
- [ ] Notification, lock-screen and headset play/pause/next/previous controls work.
- [ ] Audio focus and noisy-route events behave correctly.
- [ ] Queue, position, metadata, shuffle and repeat remain synchronized between native service and WebView.
- [ ] Process recreation restores the correct item and queue state.
- [ ] EQ, effects and visualizer are compared against the current PWA behavior on actual devices.
- [ ] Radio remains live and station controls work.
- [ ] Local imports remain available after app restart and force-stop.
- [ ] YouTube handoff never overlaps native playback; any background limitation is stated accurately.
- [ ] Android 15+ insets and keyboard layout are verified.
- [ ] Original PWA repository remains unchanged.
- [ ] All build, test and device services remain within the user's ₹0 budget.

## Current decision

This document defines a proposed direction, not a completed implementation. No Media3 dependency, service, manifest permission, JavaScript bridge command, or PWA source patch has been added as part of this architecture review. First implementation should be a small isolated Media3 proof of concept, only after the command/source contract and local-library strategy are finalized.


## Source-contract verification update — 22 November 2026

A fresh read-only inspection of the current PWA `js/audio-engine.js`, `js/state.js`, `js/storage.js`, `js/local-library.js`, and `js/media-session.js` found an important distinction that must be reflected in implementation planning:

- The current `AudioEngine.play()` routing explicitly handles YouTube IFrame tracks, live radio, and local/custom tracks. The final fallback pauses the players and reports that no playable audio source is attached. A generic direct-remote-audio playback branch was **not found** in the inspected implementation. Therefore, “direct remote audio track” in the proposed routing table is a future source capability, not a verified existing PWA source. Do not build a Media3 route for it until a real source descriptor and UI path exist.
- The active web state is an in-memory `state.currentSong`, `state.queue`, and `state.queueIndex`. Queue metadata is persisted to localStorage as `queueData`, `queueIndex`, and ID arrays; state notifications include `songChanged`, `queueChanged`, `playbackStateChanged`, and `timeUpdate`. This is the actual integration seam to map, not an assumed generic player API.
- Local audio bytes are stored in IndexedDB database `MusiqLibraryDB`, object store `audioBlobs`, keyed by track ID. The PWA recreates transient Blob URLs from those blobs during playback. Persisted local metadata is separate from the audio bytes. A transient Blob URL is not a durable URI for a native service.
- Radio has its own `radioAudio` element; standard/local HTMLAudio uses `htmlAudio`; YouTube has its own IFrame player. The existing browser Media Session handlers call `audioEngine.play/pause/nextTrack/prevTrack/seek` directly. A native integration must replace or adapt those action paths on Android rather than leave the browser and native players competing.
- The inspected EQ state includes `eqBands`, `preamp`, `bassBoost`, `stereoWiden`, and `reverb`. Do not assume a native processor can reproduce every control exactly; first map each UI control to the actual Web Audio node/value and define measurable parity tests.

### Consequence for the first Media3 proof of concept

The proposed “one direct remote audio item” spike is not currently an end-to-end PWA feature path. Before integrating Media3, either (a) prove a narrowly scoped Android-only demo/test source with an explicit test-only UI and keep it out of the production feature claim, or (b) first define a genuine user-facing source type in the existing product requirements. Do not silently invent a new source type or label it as preserving an existing PWA feature. The safer current next step is to finish a source/command mapping and a generated-bundle adapter design, then choose a POC that can be tested without changing the PWA repository.

This update is based on source inspection only. No PWA file, Android playback source, dependency, manifest permission, or APK was changed or built.


## Implementation update — Android radio Media3 POC code added (22 November 2026)

This section supersedes the earlier planning-only status above. The first scoped implementation has been committed to the Android repository. It is **source implementation only** at this point: no new APK build or runtime/device test has yet been performed.

### Implemented in the Android repository

- Added RadioPlaybackService.kt with one native ExoPlayer and one MediaSession hosted by MediaSessionService.
- Added Media3 1.11.1 ExoPlayer and Session dependencies consistently.
- Declared the media playback foreground-service type and required foreground-service permissions.
- Configured ExoPlayer to handle Android audio focus and pause automatically when the audio route becomes noisy (for example, headset unplug).
- Restricted external MediaSession player commands to play/pause and read-only current-item, metadata and timeline access. No seek, playlist mutation, next or previous commands are exposed in this first POC.
- Added RadioBridge.kt using AndroidX WebKit WebViewCompat.addWebMessageListener() with the exact https://appassets.androidplatform.net origin, main-frame check, strict version/command/key schema, 16 KiB message limit, volume bounds and station allowlist.
- Native radio accepts only the 12 existing PWA station IDs paired with their exact verified HTTPS stream URLs. Artwork is limited to the existing images.unsplash.com host.
- Added a generated-bundle adapter and patcher under scripts/. The workflow patches only the temporary viora-source/ checkout; the original prem-pk-dev/VILORA repository remains read-only.
- The adapter routes only the existing live-radio path to Media3. It pauses and clears WebView audio elements before native radio starts. Switching to YouTube or local/custom playback waits for a radio.stopped acknowledgement before WebView playback begins.
- Added a fixture test for the deterministic patcher, including duplicate-run rejection.
- Added a Web MediaSession ownership handoff: while native radio owns playback, the generated Android bundle suppresses the competing WebView MediaSession metadata/actions; after native radio stops, the WebView handlers are restored. This avoids two competing system media sessions for one radio item.
- The native service stores the selected station descriptor in app-private preferences so the WebView can request a snapshot and resume a paused station after Activity/WebView or service recreation. This is not yet runtime-verified.

### Intentionally unchanged

- YouTube IFrame playback remains in WebView.
- Standard HTMLAudio/Web Audio, local/custom playback, the 10-band EQ, effects and visualizer remain in their existing PWA paths.
- No PWA source file has been changed.
- No API key or GitHub token has been added to the APK.
- No automatic service start occurs at app launch; native radio starts only after a user selects a station.

### Verification status

- [ ] Run the manual GitHub Actions workflow once after the implementation batch is complete.
- [ ] Inspect the built APK and verify the service, permissions, bridge and bundled adapter.
- [ ] Verify all 12 station routes, install/launch, radio play/pause/resume, native notification and lock-screen controls, audio focus, headphone unplug, service recreation, WebView recreation and source handoff on a real device/emulator.
- [ ] Verify that YouTube/local/custom playback never overlaps native radio.
- [ ] Verify Android 15+ edge-to-edge layout.
- [ ] Only after build/static checks pass, verify BrowserStack's actual free quota and 30-minute policy before starting any session. Do not use paid time, trials or billing.

Current state: code committed; build and runtime verification pending. Maintain the ₹0 budget and preserve the BrowserStack free allowance until the test session is fully prepared.
