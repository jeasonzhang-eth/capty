import { describe, it, expect, vi, beforeEach } from "vitest";
import { SidecarManager } from "../../src/main/sidecar";

// Mock child_process
vi.mock("child_process", () => {
  const mockProcess = {
    pid: 12345,
    kill: vi.fn(),
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  };
  return {
    spawn: vi.fn(() => mockProcess),
    _mockProcess: mockProcess,
  };
});

// Mock fs.existsSync
vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
}));

// Mock fetch for health checks
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const defaultOpts = {
  sidecarDir: "/path/to/sidecar",
  modelsDir: "/path/to/models",
  isDev: true,
};

describe("SidecarManager", () => {
  let manager: SidecarManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SidecarManager(defaultOpts);
  });

  it("initializes with correct state", () => {
    expect(manager.isReady()).toBe(false);
  });

  it("start spawns process with correct arguments", async () => {
    const { spawn } = await import("child_process");
    mockFetch.mockResolvedValue({ ok: true });

    await manager.start();

    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining("python"),
      expect.arrayContaining([
        "-m",
        "capty_sidecar.main",
        "--port",
        expect.any(String),
        "--models-dir",
        "/path/to/models",
      ]),
      expect.any(Object),
    );
  });

  it("getPort returns assigned port after start", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await manager.start();
    const port = manager.getPort();
    expect(typeof port).toBe("number");
    expect(port).toBeGreaterThan(0);
  });

  it("getUrl returns correct URL", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await manager.start();
    expect(manager.getUrl()).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it("stop kills the child process", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await manager.start();
    manager.stop();
    expect(manager.isReady()).toBe(false);
  });

  it("isReady returns true after successful start", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await manager.start();
    expect(manager.isReady()).toBe(true);
  });
});
