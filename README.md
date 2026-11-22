# VIORA Android

Separate Android application for the existing VIORA PWA. The production PWA repository is **not modified** by this project.

## Build model

- Android source: Kotlin + Android WebView.
- UI: the exact production Vite build output from `prem-pk-dev/VILORA`, copied into the APK at build time.
- Android build: GitHub Actions (no Android Studio/JDK/SDK installation required on the user's computer).
- Output: debug APK uploaded as a workflow artifact.
- Budget: GitHub Actions free allowance only; no paid service is enabled.

## Required GitHub configuration

The PWA repository is private, so GitHub Actions in this repository needs a read-only token to check it out.

1. Create a GitHub fine-grained personal access token restricted to **only** `prem-pk-dev/VILORA`, with **Contents: Read-only** permission.
2. In this repository open **Settings → Secrets and variables → Actions → New repository secret**.
3. Add secret name `VIORA_SOURCE_TOKEN` and paste the token. Never put the token in source code or chat.

The PWA's API routes are same-origin (`/api/lyrics` and `/api/youtube/search`). The app's native WebView client forwards those requests to the configured public API origin. Add repository variable `VIORA_API_BASE_URL` under **Settings → Secrets and variables → Actions → Variables**. It must be an HTTPS origin that serves the VIORA API routes without interactive login/SSO. A Vercel domain protected by SSO cannot be used by the APK.

## Build APK

1. Add the secret and API-origin variable above.
2. Open **Actions → Build VIORA Android APK → Run workflow**.
3. Wait for the workflow to finish.
4. Download the `VIORA-debug-apk` artifact from the successful run and install it on the Android phone.

A workflow run is deliberately blocked when the private source token or public API origin is missing. This prevents producing an APK that looks complete but silently lacks PWA assets or online API functionality.

## Preservation contract

- Do not edit or deploy `prem-pk-dev/VILORA` from this repository.
- Do not redesign, remove, or replace existing VIORA screens/features.
- The app bundles the built PWA locally; online services still need internet.
- Local music selection is handled through Android's document picker.
- Native background playback/MediaSession enhancements must be added only after compatibility testing against VIORA's existing HTMLAudio/WebAudio/YouTube playback paths.
- Never report a feature as verified until it has passed build and real-device tests.

## Current implementation status

Initial Android shell and cloud-build pipeline are being established. The APK is not yet considered feature-complete or device-tested.
