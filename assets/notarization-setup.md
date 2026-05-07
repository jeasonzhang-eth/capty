# macOS Notarization Setup

Capty ships a dormant notarization pipeline: `build/notarize.js` is registered as an `afterSign` hook in `electron-builder.yml` but no-ops unless three environment variables are present. This document explains how to activate it.

## Prerequisites

1. **Apple Developer account** — $99/year at <https://developer.apple.com/programs/enroll/>.
2. **Developer ID Application certificate** — create in Xcode (Settings → Accounts → Manage Certificates → `+` → Developer ID Application) or via the developer portal. Installs into the login Keychain.
3. **App-Specific Password** — create at <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords. Store it safely; it is shown only once.
4. **Team ID** — 10-character string, visible at <https://developer.apple.com/account> → Membership Details.

## Activation

Export three environment variables before running the build:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"

npm run dist
```

`electron-builder` signs the app with the Developer ID certificate from Keychain, then `build/notarize.js` submits the signed `.app` to Apple via `notarytool`. Notarization typically takes 2–10 minutes. On success the binary is stapled automatically by electron-builder's default `afterAllArtifactBuild` step, and the DMG Gatekeeper-opens on any Mac without a right-click workaround.

## Verification

After a notarized build:

```bash
spctl -a -vv --type execute dist/mac-arm64/Capty.app
# Expected: "accepted" + "source=Notarized Developer ID"

stapler validate dist/mac-arm64/Capty.app
# Expected: "The validate action worked!"
```

## Troubleshooting

- **"errSecInternalComponent" during signing** — Keychain locked, or Developer ID cert missing. `security find-identity -v -p codesigning` should list at least one `Developer ID Application:` identity.
- **Notarization rejected** — read the log URL printed by `notarytool`. Most common issue is an unsigned helper binary; check `hardenedRuntime`-required entitlements in `build/entitlements.mac.plist`.
- **Hook is silently skipping when credentials are set** — double-check spelling of the env var names. The hook requires ALL three to be non-empty.

## Deactivation

Unset any one of `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` and the hook reverts to its no-op skip path. No code changes needed.
