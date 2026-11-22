# VIORA Android real-device test plan

Do not mark the Android build complete until the following checks are performed on the user's Android phone.

## Install and startup
- [ ] Debug APK installs without package/signature errors.
- [ ] App opens to the original VIORA UI with the same dark theme, typography, navigation, layout, and player shell.
- [ ] App can restart and reopen the local bundled UI without requiring the PWA website host.
- [ ] Status bar, navigation bar, keyboard, and safe insets do not cover the UI.

## Routes and UI
- [ ] Home, Search, Genres & Moods, Radio, Podcasts.
- [ ] Local Music, All Songs, Albums, Album Detail, Artists, Artist Detail.
- [ ] Playlists, Playlist Detail, Favorites, Recently Played, Most Played, Offline Downloads.
- [ ] Synced Lyrics, Equalizer, Visualizer, Listening Analytics, Settings.
- [ ] Fullscreen player, queue, mobile navigation, video/lyrics panels, modal and toast behavior.

## Playback
- [ ] Online audio track play/pause/seek/next/previous.
- [ ] Radio stream playback and station changes.
- [ ] YouTube search results, embedded video playback, audio/video view switching.
- [ ] Screen lock and background playback.
- [ ] Media notification, lock-screen controls, headset buttons, audio focus and interruptions.
- [ ] Web Audio EQ, bass/treble, stereo, reverb, compressor, analyser and visualizer.

## Local library
- [ ] Android picker opens from VIORA's existing Add/Import controls.
- [ ] Single and multiple audio file selection.
- [ ] ID3 metadata and embedded artwork parsing.
- [ ] Audio bytes and metadata persist in IndexedDB after app close/reopen.
- [ ] Local playback works after app restart and offline.
- [ ] Duplicate detection, remove track, playlist/favorite metadata.

## Online services and offline behavior
- [ ] LRCLIB exact and fallback lyric search.
- [ ] YouTube search route returns expected JSON and usable video IDs.
- [ ] Weather, remote artwork, external images, radio streams, and YouTube iframe need internet.
- [ ] First online launch populates the service-worker cache.
- [ ] Cached app UI opens offline; online API requests fail gracefully and recover after reconnect.

## Known limitations before feature-complete sign-off

- [ ] **YouTube pagination:** the Android direct-HTML fallback currently returns `nextPageToken: null`. The unchanged PWA server route behaves the same when `YOUTUBE_API_KEY` is not configured. Do not show a fake continuation token or embed an API key in the APK. Revisit only with a tested continuation implementation or a user-configured secure backend.
- [ ] **Background playback / native media controls:** not implemented or verified yet. The current Web Audio / HTMLAudio / YouTube IFrame playback engine must remain the single playback engine during any first integration attempt. Do not add a second ExoPlayer/Media3 playback engine beside it; that could desynchronize queue, EQ, visualizer, radio, YouTube and local playback. Any native session/foreground-service bridge must prove lifecycle behavior, command synchronization, audio focus, screen-off playback and process recreation before being accepted.
- [ ] **Android 15 edge-to-edge:** safe-area inset handling is present in `MainActivity.kt`, but visual verification on Android 15+ is still pending.

## Android bridge / playback integration gates (before BrowserStack)

- [ ] Source capability is explicit: YouTube stays in WebView; radio is live and non-seekable; existing local Blob playback remains in WebView until persistent URI migration is implemented.
- [ ] Unknown or unsupported track descriptors fail closed; no guessed `url` field and no silent fallback to a second player.
- [ ] JS/native command contract is versioned, allow-listed, size-bounded, and rejects untrusted schemes/origins.
- [ ] Native events update the existing UI without re-triggering playback or duplicating queue mutations.
- [ ] `prevTrack()` semantics are preserved: radio changes station; regular in-app previous restarts after 3 seconds; lock-screen Media Session previous currently selects the previous queue item.
- [ ] Queue state (`queue`, `queueIndex`) and `queueChanged` / `songChanged` / `playbackStateChanged` / `timeUpdate` round-trip without loops.
- [ ] Android-only generated-bundle patch checks fail closed if expected PWA bundle anchors change; original PWA repo remains untouched.
- [ ] No Media3 implementation is accepted until a genuine supported source type and rollback path are documented.

## Stability and security
- [ ] External top-level links open outside the app; embedded YouTube and remote media still work.
- [ ] No mixed-content or JavaScript bridge security warnings.
- [ ] App survives rotation, process recreation, and low-memory resume.
- [ ] No crash or ANR during long playback, large local imports, or route switching.


## Additional source-contract note — 22 November 2026

- Current PWA playback routing was rechecked in `js/audio-engine.js`: YouTube IFrame, live radio, and local/custom tracks have explicit playback paths. A generic direct-remote-audio playback path was not found; do not count that as an existing working feature or use it as the first production integration target without a separate product decision.
- Local audio bytes live in IndexedDB (`MusiqLibraryDB` / `audioBlobs`); the WebView creates temporary Blob URLs for playback. Local metadata in localStorage alone is not enough to restore the audio bytes in a native service.
- Native playback work remains unimplemented. No Media3 service, native controls, or background-playback behavior is considered tested.
