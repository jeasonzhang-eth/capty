import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("../../../src/main/shared/spawn", () => ({ spawn: mockSpawn }));

import { mergeAudioFiles } from "../../../src/main/audio/merge";

function fakeProc() {
  const ee = new EventEmitter() as EventEmitter & { kill?: () => void };
  return ee;
}

describe("mergeAudioFiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when fewer than 2 inputs are given", async () => {
    await expect(mergeAudioFiles(["/a.wav"], "/out.wav")).rejects.toThrow(
      /at least 2/,
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("builds a concat-filter command with inputs in order and canonical format", async () => {
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);
    const p = mergeAudioFiles(["/a.wav", "/b.m4a", "/c.mp3"], "/out.wav");
    proc.emit("close", 0);
    await expect(p).resolves.toBeUndefined();

    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe("ffmpeg");
    const joined = (args as string[]).join(" ");
    expect(joined).toContain("-i /a.wav -i /b.m4a -i /c.mp3");
    expect(joined).toContain("[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]");
    expect(args).toContain("-map");
    expect(args).toContain("[out]");
    expect(joined).toContain("-ar 16000");
    expect(joined).toContain("-ac 1");
    expect(joined).toContain("-sample_fmt s16");
    expect((args as string[])[(args as string[]).length - 1]).toBe("/out.wav");
  });

  it("rejects with the exit code on non-zero ffmpeg exit", async () => {
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);
    const p = mergeAudioFiles(["/a.wav", "/b.wav"], "/out.wav");
    proc.emit("close", 1);
    await expect(p).rejects.toThrow(/code 1/);
  });

  it("rejects when ffmpeg cannot be spawned", async () => {
    const proc = fakeProc();
    mockSpawn.mockReturnValue(proc);
    const p = mergeAudioFiles(["/a.wav", "/b.wav"], "/out.wav");
    proc.emit("error", new Error("ENOENT"));
    await expect(p).rejects.toThrow(/ffmpeg/i);
  });
});
