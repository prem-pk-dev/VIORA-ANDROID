# VIORA PWA source audit

Audit source: `prem-pk-dev/VILORA`, default branch `main`. This is a read-only audit; no source PWA files were changed.

## Verified project structure

- Build tool: Vite 6, configured in `vite.config.ts`.
- Main build command: `npm run build` → `vite build`.
- Other scripts: `npm run lint` → `tsc --noEmit`; `npm test` → `node --test`.
- Dependencies include React 19, Vite, Tailwind's Vite plugin, Lucide React, Motion, Express, dotenv, TypeScript, esbuild, and sharp.
- The visible app shell and most application behavior are in `index.html` plus vanilla JavaScript modules under `js/`. `src/main.tsx` mounts `src/App.tsx`, whose current component returns `null`; the hidden React root is not the main rendered interface.
- PWA manifest files: `public/manifest.webmanifest` and `public/manifest.json`.
- Service worker: `public/sw.js`; it precaches app-shell resources, uses network-only behavior for `/api/*`, and falls back to cached app pages/resources when offline.
- Vercel routes: `api/lyrics.ts` and `api/youtube/search.ts`.

## Verified routes and feature areas

The hash router in `js/app.js` includes:
- Home, Search, Genres & Moods
- Local Music, All Songs, Albums, Album Detail
- Artists, Artist Detail
- Playlists, Playlist Detail, Favorites, Recently Played, Most Played, Offline Downloads
- Live Radio, Podcasts
- Synced Lyrics, Equalizer, Visualizer, Listening Analytics, Settings

The existing UI also includes the main player, fullscreen player, audio/video/lyrics views, queue/right panel, mobile navigation, and YouTube floating player.

## Existing playback and local-media design

- `js/audio-engine.js` uses HTMLAudio elements for track and radio playback and a Web Audio graph for the 10-band EQ, bass/treble, stereo, compressor, reverb, and analyser/visualizer signal.
- YouTube playback is handled separately by `js/youtube-player.js` using the YouTube IFrame API.
- `js/media-session.js` already registers browser Media Session metadata and play/pause/previous/next/seek actions.
- `js/local-library.js` supports browser file/folder selection, ID3 parsing, duplicate detection, track metadata, and object URLs.
- `js/storage.js` persists imported audio blobs and metadata in IndexedDB. The local library reloads those audio records at startup. The Android app must preserve this origin's IndexedDB data and avoid changing the web audio model without a tested migration.
- These separate audio paths mean a second Media3 player cannot simply be substituted without risking regressions to YouTube, radio, Web Audio effects, and player state synchronization.

## Existing API behavior

- `/api/lyrics` queries LRCLIB, first attempting an exact title/artist match and then search permutations; it prefers synchronized lyrics and scores language/title/artist/duration matches.
- `/api/youtube/search` uses YouTube Data API v3 when `YOUTUBE_API_KEY` is configured, then falls back to fetching YouTube's search HTML and extracting video renderers.
- The Android shell now has a native adapter for these two routes: LRCLIB queries and the existing YouTube HTML-search fallback are performed by Kotlin and returned to the unchanged PWA as same-origin JSON responses. No separate API host or paid backend is required by the Android build.
- Other remote sources (weather, artwork, YouTube iframe playback, radio streams, etc.) remain internet-dependent.

## Android-specific compatibility risks to test

1. YouTube IFrame API playback and its autoplay/background restrictions inside Android WebView.
2. HTMLAudio/WebAudio playback while the app is backgrounded or the screen is locked.
3. Media Session notification and lock-screen action behavior in WebView.
4. Audio focus, incoming calls, headphones, and playback interruptions.
5. Android document picker import, multiple selection, IndexedDB persistence, and local file playback after app restart.
6. Web Audio 10-band EQ, reverb, analyser, visualizer frame rate, and device audio output.
7. Service worker, IndexedDB, Cache Storage, and app startup from the local `appassets.androidplatform.net` secure origin.
8. Network-offline transitions for remote APIs, weather, artwork, radio, and YouTube.

## Current Android implementation

- Kotlin WebView shell uses AndroidX WebViewAssetLoader to load bundled PWA build files from a secure local HTTPS-style origin.
- Android document picker supports the existing PWA audio file input.
- Native API interception serves the existing `/api/lyrics` and `/api/youtube/search` endpoints without requiring a Vercel domain or a public API key.
- GitHub Actions checks out the private PWA repository read-only, runs its Vite build, copies `dist/` and the existing 512px app icon into the Android app, then builds and uploads a debug APK.
- The Android repo's workflow is manual-only to avoid consuming free Actions minutes on every commit.
- A fine-grained GitHub token with Contents: Read-only access to only `prem-pk-dev/VILORA` is required as the `VIORA_SOURCE_TOKEN` repository secret.

## Not yet verified

- No successful Android Gradle build has yet been run.
- No APK has yet been installed on a physical Android phone.
- No background playback, notification, lock-screen, headphone, YouTube, equalizer, or offline feature is marked device-tested.
