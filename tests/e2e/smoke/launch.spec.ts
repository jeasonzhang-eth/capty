import { test, expect } from "../fixtures";

test.describe("app launch", () => {
  test("main window is created and visible", async ({ seededApp }) => {
    const { app, window } = seededApp;

    // Exactly one window
    const windows = app.windows();
    expect(windows.length).toBe(1);

    // Window is visible and has a body
    expect(await window.isVisible("body")).toBe(true);
  });

  test("window title is set", async ({ seededApp }) => {
    const title = await seededApp.window.title();
    // Electron default title falls back to package.json `name` or index.html <title>.
    // Accept either "capty" or a human-friendly title.
    expect(title.toLowerCase()).toMatch(/capty/);
  });
});
