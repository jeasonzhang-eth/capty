// afterSign hook: notarize the macOS .app when Apple credentials are set.
// Inert by design — returns silently unless APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
// and APPLE_TEAM_ID are all present in the environment.
// See docs/notarization-setup.md for activation steps.

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('[notarize] Apple credentials not set — skipping notarization.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const appBundleId = context.packager.appInfo.id;

  console.log(`[notarize] Submitting ${appPath} for notarization (team ${APPLE_TEAM_ID})…`);
  await notarize({
    appBundleId,
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log('[notarize] Notarization complete.');
};
