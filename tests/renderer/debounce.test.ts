import { describe, it, expect, vi } from "vitest";
import { createSpeechDebouncer } from "../../src/renderer/vad/debounce";

function make(overrides = {}) {
  const onSpeechStart = vi.fn();
  const onSpeechEnd = vi.fn();
  const d = createSpeechDebouncer({
    speechFrames: 8,
    silenceFrames: 32,
    maxSpeechFrames: 938,
    onSpeechStart,
    onSpeechEnd,
    ...overrides,
  });
  return { d, onSpeechStart, onSpeechEnd };
}

describe("createSpeechDebouncer", () => {
  it("fires onSpeechStart after speechFrames consecutive speech frames", () => {
    const { d, onSpeechStart } = make();
    for (let i = 0; i < 7; i++) d.push(true);
    expect(onSpeechStart).not.toHaveBeenCalled();
    d.push(true); // 8th
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("ignores isolated speech blips shorter than speechFrames", () => {
    const { d, onSpeechStart } = make();
    for (let i = 0; i < 5; i++) d.push(true);
    d.push(false); // resets speech counter
    for (let i = 0; i < 5; i++) d.push(true);
    expect(onSpeechStart).not.toHaveBeenCalled();
  });

  it("fires onSpeechEnd after silenceFrames consecutive silence while speaking", () => {
    const { d, onSpeechStart, onSpeechEnd } = make();
    for (let i = 0; i < 8; i++) d.push(true); // start
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 31; i++) d.push(false);
    expect(onSpeechEnd).not.toHaveBeenCalled();
    d.push(false); // 32nd
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("forces a segment break (end+start) at maxSpeechFrames", () => {
    const { d, onSpeechStart, onSpeechEnd } = make({ maxSpeechFrames: 10 });
    for (let i = 0; i < 8; i++) d.push(true); // start (count 1..8)
    // continue speaking; continuous counter hits maxSpeechFrames
    for (let i = 0; i < 10; i++) d.push(true);
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(onSpeechStart).toHaveBeenCalledTimes(2); // initial + forced restart
  });

  it("reset() clears state so a new start requires speechFrames again", () => {
    const { d, onSpeechStart } = make();
    for (let i = 0; i < 8; i++) d.push(true);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    d.reset();
    for (let i = 0; i < 7; i++) d.push(true);
    expect(onSpeechStart).toHaveBeenCalledTimes(1); // not yet
    d.push(true);
    expect(onSpeechStart).toHaveBeenCalledTimes(2);
  });
});
