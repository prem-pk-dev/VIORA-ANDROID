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
| Direct remote audio track | Media3 service | Standard stream/file URL; native queue and seek |
| Live radio | Media3 service | Live metadata; no arbitrary seek; station next/previous |
| New Android local import | Media3 service | Persisted SAF content:// URI permission; native metadata |
| Existing PWA IndexedDB/Blob local track | Not yet decided | Requires a safe migration/adapter; a Blob URL cannot simply be passed to a service |
| YouTube IFrame track/video | WebView YouTube player | Keep existing player; do not create a second native audio copy |

Do not route a source to Media3 until its URL/URI, metadata, duration/live status, identity, and permission lifetime are known. If a source cannot be resolved safely, report a controlled unsupported/error state; do not start a second fallback player behind the user's back.

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
