import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

interface MockDb {
  close: ReturnType<typeof vi.fn>;
}

interface SetupOptions {
  readonly config?: Record<string, unknown>;
  readonly userDataPath?: string;
  readonly envUserDataOverride?: string;
  readonly createDatabaseResults?: Array<MockDb | Error>;
}

async function setupMainIndex(options: SetupOptions = {}) {
  vi.resetModules();

  const handlers = new Map<string, (...args: any[]) => any>();
  const appEvents = new Map<string, (...args: any[]) => any>();
  let configState = {
    dataDir: null,
    windowBounds: null,
    zoomFactor: null,
    ...(options.config ?? {}),
  };

  const userDataPath =
    options.userDataPath ??
    fs.mkdtempSync(path.join(os.tmpdir(), "capty-main-index-userdata-"));
  const browserWindowEvents = new Map<string, (...args: any[]) => void>();
  const browserWindow = {
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      browserWindowEvents.set(event, cb);
    }),
    getBounds: vi.fn(() => ({ x: 10, y: 20, width: 1200, height: 800 })),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    show: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    webContents: {
      setZoomFactor: vi.fn(),
      getZoomFactor: vi.fn(() => 1),
      setWindowOpenHandler: vi.fn(),
    },
  };

  const createDatabaseQueue = [...(options.createDatabaseResults ?? [])];
  const createdDbs: MockDb[] = [];
  const createDatabaseMock = vi.fn((dbPath: string) => {
    const next = createDatabaseQueue.shift();
    if (next instanceof Error) throw next;
    const db =
      next ??
      ({
        close: vi.fn(),
      } satisfies MockDb);
    createdDbs.push(db);
    return db;
  });
  const migrateUtcToLocalMock = vi.fn(() => []);
  const writeConfigMock = vi.fn(
    (_dir: string, config: Record<string, unknown>) => {
      configState = { ...config };
    },
  );
  const readConfigMock = vi.fn(() => configState);
  const registerIpcHandlersMock = vi.fn();
  const migrateModelsDirMock = vi.fn();
  const killSidecarMock = vi.fn();
  const repairWavHeadersMock = vi.fn();

  const BrowserWindowMock: any = vi.fn(() => browserWindow);
  BrowserWindowMock.getAllWindows = vi.fn(() => []);

  vi.doMock("electron", () => ({
    app: {
      isPackaged: false,
      setPath: vi.fn(),
      getPath: vi.fn((name: string) =>
        name === "userData" ? userDataPath : "/tmp/unused",
      ),
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn((event: string, cb: (...args: any[]) => void) => {
        appEvents.set(event, cb);
      }),
      quit: vi.fn(),
    },
    BrowserWindow: BrowserWindowMock,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
        handlers.set(channel, handler);
      }),
    },
    shell: {
      openExternal: vi.fn(),
    },
    systemPreferences: {
      askForMediaAccess: vi.fn().mockResolvedValue(true),
    },
  }));

  vi.doMock("@electron-toolkit/utils", () => ({
    is: { dev: false },
  }));

  vi.doMock("../../src/main/config", () => ({
    readConfig: readConfigMock,
    writeConfig: writeConfigMock,
  }));

  vi.doMock("../../src/main/database", () => ({
    createDatabase: createDatabaseMock,
    migrateUtcToLocal: migrateUtcToLocalMock,
  }));

  vi.doMock("../../src/main/ipc-handlers", () => ({
    registerIpcHandlers: registerIpcHandlersMock,
    migrateModelsDir: migrateModelsDirMock,
    killSidecar: killSidecarMock,
  }));

  vi.doMock("../../src/main/audio-files", () => ({
    repairWavHeaders: repairWavHeadersMock,
  }));

  const oldOverride = process.env.ELECTRON_USER_DATA_DIR_OVERRIDE;
  if (options.envUserDataOverride) {
    process.env.ELECTRON_USER_DATA_DIR_OVERRIDE = options.envUserDataOverride;
  } else {
    delete process.env.ELECTRON_USER_DATA_DIR_OVERRIDE;
  }

  await import("../../src/main/index");
  await Promise.resolve();

  const electron = await import("electron");

  return {
    handlers,
    appEvents,
    browserWindow,
    browserWindowEvents,
    createdDbs,
    mocks: {
      createDatabaseMock,
      migrateUtcToLocalMock,
      writeConfigMock,
      readConfigMock,
      registerIpcHandlersMock,
      migrateModelsDirMock,
      killSidecarMock,
      repairWavHeadersMock,
      app: electron.app as any,
      shell: (electron as any).shell,
      BrowserWindow: (electron as any).BrowserWindow,
    },
    cleanupEnv: () => {
      if (oldOverride === undefined) {
        delete process.env.ELECTRON_USER_DATA_DIR_OVERRIDE;
      } else {
        process.env.ELECTRON_USER_DATA_DIR_OVERRIDE = oldOverride;
      }
    },
    getConfigState: () => configState,
    userDataPath,
  };
}

describe("main/index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.ELECTRON_USER_DATA_DIR_OVERRIDE;
  });

  it("honors ELECTRON_USER_DATA_DIR_OVERRIDE before app ready", async () => {
    const setup = await setupMainIndex({
      envUserDataOverride: "/tmp/override-user-data",
    });

    expect(setup.mocks.app.setPath).toHaveBeenCalledWith(
      "userData",
      "/tmp/override-user-data",
    );
    expect(setup.browserWindow.loadFile).toHaveBeenCalledWith(
      expect.stringContaining("renderer/index.html"),
    );
    expect(setup.mocks.registerIpcHandlersMock).toHaveBeenCalledTimes(1);

    setup.cleanupEnv();
  });

  it("app:init-data-dir persists config and initializes the database once", async () => {
    const setup = await setupMainIndex();
    const handler = setup.handlers.get("app:init-data-dir");

    expect(handler).toBeDefined();
    expect(setup.mocks.createDatabaseMock).not.toHaveBeenCalled();

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-init-"));
    handler!({} as any, dataDir);

    expect(setup.getConfigState().dataDir).toBe(dataDir);
    expect(setup.mocks.createDatabaseMock).toHaveBeenCalledTimes(1);
    expect(setup.mocks.createDatabaseMock).toHaveBeenCalledWith(
      path.join(dataDir, "capty.db"),
    );

    handler!({} as any, dataDir);
    expect(setup.mocks.createDatabaseMock).toHaveBeenCalledTimes(1);

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("app:init-data-dir rejects system directories", async () => {
    const setup = await setupMainIndex();
    const handler = setup.handlers.get("app:init-data-dir");
    expect(() => handler!({} as any, "/")).toThrow(/system directory/);
    expect(() => handler!({} as any, "/etc/capty")).toThrow(/system directory/);
    expect(() => handler!({} as any, "/usr/local/evil")).toThrow(
      /system directory/,
    );
    expect(() => handler!({} as any, "")).toThrow(/empty/);
  });

  it("app:change-data-dir rejects system directories", async () => {
    const existingDir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-ex-"));
    const setup = await setupMainIndex({
      config: { dataDir: existingDir },
      createDatabaseResults: [{ close: vi.fn() }],
    });
    const handler = setup.handlers.get("app:change-data-dir");
    expect(() => handler!({} as any, "/")).toThrow(/system directory/);
    expect(() => handler!({} as any, "/etc/capty")).toThrow(/system directory/);
    expect(() => handler!({} as any, "")).toThrow(/empty/);
    fs.rmSync(existingDir, { recursive: true, force: true });
  });

  it("app:change-data-dir rolls back config and restores db when re-init fails", async () => {
    const oldDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "capty-main-index-old-data-"),
    );
    const newDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "capty-main-index-new-data-"),
    );
    fs.rmSync(newDataDir, { recursive: true, force: true });
    fs.writeFileSync(path.join(oldDataDir, "marker.txt"), "keep-me");

    const initialDb = { close: vi.fn() };
    const restoredDb = { close: vi.fn() };

    const setup = await setupMainIndex({
      config: { dataDir: oldDataDir },
      createDatabaseResults: [initialDb, new Error("open failed"), restoredDb],
    });

    const handler = setup.handlers.get("app:change-data-dir");
    expect(handler).toBeDefined();

    let thrown: unknown;
    try {
      handler!({} as any, newDataDir);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("open failed");

    expect(initialDb.close).toHaveBeenCalledTimes(1);
    expect(setup.getConfigState().dataDir).toBe(oldDataDir);
    expect(setup.mocks.createDatabaseMock).toHaveBeenCalledTimes(3);
    expect(fs.existsSync(path.join(newDataDir, "marker.txt"))).toBe(true);
  });

  it("before-quit kills sidecar and closes the active database", async () => {
    const db = { close: vi.fn() };
    const setup = await setupMainIndex({
      config: { dataDir: "/tmp/capty-data" },
      createDatabaseResults: [db],
    });

    const beforeQuit = setup.appEvents.get("before-quit");
    expect(beforeQuit).toBeDefined();

    beforeQuit!();

    expect(setup.mocks.killSidecarMock).toHaveBeenCalledTimes(1);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it("app:change-data-dir returns no-op when target matches current dir", async () => {
    const currentDir = path.join(os.tmpdir(), "capty-current-data-dir");
    const setup = await setupMainIndex({
      config: { dataDir: currentDir },
      createDatabaseResults: [{ close: vi.fn() }],
    });

    const handler = setup.handlers.get("app:change-data-dir");
    expect(handler).toBeDefined();

    const result = handler!({} as any, currentDir);

    expect(result).toEqual({ changed: false, migrated: false });
    expect(setup.getConfigState().dataDir).toBe(currentDir);
    expect(setup.mocks.createDatabaseMock).toHaveBeenCalledTimes(1);
  });

  it("ready-to-show applies zoom factor and shows the window", async () => {
    const setup = await setupMainIndex({
      config: { zoomFactor: 1.5 },
    });

    const readyToShow = setup.browserWindowEvents.get("ready-to-show");
    expect(readyToShow).toBeDefined();

    readyToShow!();

    expect(setup.browserWindow.webContents.setZoomFactor).toHaveBeenCalledWith(
      1.5,
    );
    expect(setup.browserWindow.show).toHaveBeenCalledTimes(1);
  });

  it("denies window.open and forwards only http(s) links externally", async () => {
    const setup = await setupMainIndex();
    const handler =
      setup.browserWindow.webContents.setWindowOpenHandler.mock.calls[0][0];

    expect(handler({ url: "https://example.com" })).toEqual({
      action: "deny",
    });
    expect(setup.mocks.shell.openExternal).toHaveBeenCalledWith(
      "https://example.com",
    );

    setup.mocks.shell.openExternal.mockClear();
    expect(handler({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(setup.mocks.shell.openExternal).not.toHaveBeenCalled();
  });

  it("saves window bounds after a resize event", async () => {
    vi.useFakeTimers();
    try {
      const setup = await setupMainIndex();
      const resize = setup.browserWindowEvents.get("resize");
      expect(resize).toBeDefined();

      resize!();
      vi.advanceTimersByTime(500);

      expect(setup.getConfigState().windowBounds).toEqual({
        x: 10,
        y: 20,
        width: 1200,
        height: 800,
      });
      expect(setup.mocks.writeConfigMock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("set/get zoom factor use the live window and persist the value", async () => {
    vi.useFakeTimers();
    try {
      const setup = await setupMainIndex();
      const setZoom = setup.handlers.get("app:set-zoom-factor");
      const getZoom = setup.handlers.get("app:get-zoom-factor");
      expect(setZoom).toBeDefined();
      expect(getZoom).toBeDefined();

      setup.browserWindow.webContents.getZoomFactor.mockReturnValueOnce(1.25);
      setZoom!({} as any, 1.25);

      expect(
        setup.browserWindow.webContents.setZoomFactor,
      ).toHaveBeenCalledWith(1.25);

      vi.advanceTimersByTime(500);
      expect(setup.getConfigState().zoomFactor).toBe(1.25);
      expect(getZoom!()).toBe(1.25);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a new window on activate when no windows are open", async () => {
    const setup = await setupMainIndex();
    const activate = setup.appEvents.get("activate");
    expect(activate).toBeDefined();

    expect(setup.mocks.BrowserWindow).toHaveBeenCalledTimes(1);
    setup.mocks.BrowserWindow.getAllWindows.mockReturnValueOnce([]);

    activate!();

    expect(setup.mocks.BrowserWindow).toHaveBeenCalledTimes(2);
  });

  it("window-all-closed quits on non-darwin platforms only", async () => {
    const originalPlatform = process.platform;
    const setup = await setupMainIndex();
    const handler = setup.appEvents.get("window-all-closed");
    expect(handler).toBeDefined();

    try {
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });
      handler!();
      expect(setup.mocks.app.quit).toHaveBeenCalledTimes(1);

      setup.mocks.app.quit.mockClear();
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });
      handler!();
      expect(setup.mocks.app.quit).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });
});
