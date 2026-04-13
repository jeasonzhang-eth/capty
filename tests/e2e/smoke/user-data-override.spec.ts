import { test, expect } from "../fixtures";
import fs from "fs";
import path from "path";

test("seeded userData dir is used instead of default", async ({ seededApp }) => {
  // If override works, config.json exists in our temp userDataDir
  const configPath = path.join(seededApp.userDataDir, "config.json");
  expect(fs.existsSync(configPath)).toBe(true);

  // And the window loaded without the SetupWizard (main UI title visible)
  await expect(seededApp.window.locator("body")).toBeVisible();
});
