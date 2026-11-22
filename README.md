# VIORA Android

A separate Android application for the existing VIORA PWA. This repository is isolated from the production website repository.

## Architecture

- **Android shell:** Kotlin + Android WebView.
- **PWA UI:** the unchanged Vite production build from private repository `prem-pk-dev/VILORA`, bundled locally into the APK.
- **Local media:** Android document picker passes selected audio files to the existing PWA import flow; the PWA stores audio blobs in IndexedDB.
- **PWA API compatibility:** native Kotlin adapters implement the PWA's `/api/lyrics` (LRCLIB) and `/api/youtube/search` (YouTube search-page fallback) routes. This avoids depending on Vercel SSO-protected domains or a separate paid backend.
- **Build:** GitHub Actions only. No Android Studio, JDK, or Android SDK installation is needed on the user's computer.
- **Budget:** use the existing free GitHub Actions allowance; do not enable paid services.

## One-time GitHub secret

The source PWA repository is private. GitHub Actions in this repository therefore needs read-only access to it.

1. Create a GitHub **fine-grained personal access token** restricted to only `prem-pk-dev/VILORA`.
2. Grant **Contents: Read-only** permission.
3. In this repository open **Settings → Secrets and variables → Actions → New repository secret**.
4. Name it `VIORA_SOURCE_TOKEN` and paste the token.

Never put the token in a file, commit, issue, or chat. The workflow checks out the PWA with credentials persistence disabled and does not write to the PWA repository.

## Build a debug APK

1. Add the `VIORA_SOURCE_TOKEN` secret above.
2. Open **Actions → Build VIORA Android APK → Run workflow**.
3. Wait for the run to complete successfully.
4. Download the `VIORA-debug-apk` artifact from that run.
5. Install the APK on the Android phone and test the checklist in `docs/ANDROID_TEST_PLAN.md`.

The workflow is manual-only so normal commits do not consume GitHub Actions minutes unexpectedly.

## Preservation requirements

- Do not edit, deploy, or otherwise mutate `prem-pk-dev/VILORA` from this repository.
- Do not redesign, remove, or replace existing VIORA screens, routes, styles, data, or working behavior.
- Bundle the PWA build locally so app startup/UI do not depend on the website host.
- Online YouTube, lyrics, weather, remote artwork, and other online services still require internet.
- The PWA's existing HTMLAudio/WebAudio/YouTube playback architecture must remain intact. Native background playback/MediaSession work must be added only after compatibility testing; do not replace the audio engine blindly with a second player.
- Do not call a feature complete until its build and relevant real-device tests pass.

## Current status

- The Kotlin WebView shell, local asset loading, Android file picker, and native API adapters are committed.
- A previous manual GitHub Actions build completed successfully (user-reported), and an earlier debug APK was statically inspected. That APK predates the latest workflow and Android 15 inset fixes; do not treat it as verification of the current source.
- Workflow fixes for the missing immersive-motion script and Android-only service-worker precache filtering are committed but have not yet been verified in a new APK.
- Android 15 edge-to-edge inset handling is committed but still needs emulator/device visual testing, including keyboard/IME behavior.
- YouTube direct-HTML fallback currently has no continuation token when no secure YouTube Data API key is configured. Do not fabricate pagination tokens or embed an API key in the APK.
- Native background playback, MediaSession, notification/lock-screen controls, audio focus, and headphone controls are not implemented or verified. Preserve the existing Web Audio / HTMLAudio / YouTube playback architecture; do not add a second independent player without a proven synchronization design.
- The current test checklist is in [docs/ANDROID_TEST_PLAN.md](docs/ANDROID_TEST_PLAN.md).

The current source is **not yet a verified complete APK**. Run one grouped manual build only after implementation changes are ready, then inspect the resulting artifact and test it on Android hardware. Keep all work within the user's ₹0 budget and keep the original PWA repository read-only.
