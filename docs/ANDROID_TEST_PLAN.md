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

## Stability and security
- [ ] External top-level links open outside the app; embedded YouTube and remote media still work.
- [ ] No mixed-content or JavaScript bridge security warnings.
- [ ] App survives rotation, process recreation, and low-memory resume.
- [ ] No crash or ANR during long playback, large local imports, or route switching.
