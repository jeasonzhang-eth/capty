import { describe, it, expect } from "vitest";
import {
  exportTXT,
  exportSRT,
  exportMarkdown,
  formatTimecode,
} from "../../src/main/export";

const mockSession = {
  id: 1,
  title: "Test Session",
  started_at: "2026-03-23T14:32:00",
  duration_seconds: 300,
};

const mockSegments = [
  { id: 1, start_time: 0.0, end_time: 2.5, text: "Hello world" },
  { id: 2, start_time: 3.0, end_time: 5.8, text: "你好世界" },
  { id: 3, start_time: 6.0, end_time: 9.2, text: "Mixed 中英文 content" },
];

describe("export", () => {
  describe("formatTimecode", () => {
    it("formats seconds to SRT timecode", () => {
      expect(formatTimecode(0, "srt")).toBe("00:00:00,000");
      expect(formatTimecode(62.5, "srt")).toBe("00:01:02,500");
      expect(formatTimecode(3661.123, "srt")).toBe("01:01:01,123");
    });

    it("formats seconds to simple timecode", () => {
      expect(formatTimecode(0, "simple")).toBe("00:00:00");
      expect(formatTimecode(62.5, "simple")).toBe("00:01:02");
    });
  });

  describe("exportTXT", () => {
    it("exports plain text without timestamps", () => {
      const result = exportTXT(mockSession, mockSegments, {
        timestamps: false,
      });
      expect(result).toBe("Hello world\n你好世界\nMixed 中英文 content");
    });

    it("exports plain text with timestamps", () => {
      const result = exportTXT(mockSession, mockSegments, { timestamps: true });
      expect(result).toContain("[00:00:00]");
      expect(result).toContain("Hello world");
    });
  });

  describe("exportSRT", () => {
    it("exports valid SRT format", () => {
      const result = exportSRT(mockSession, mockSegments);
      const lines = result.split("\n");
      // First entry
      expect(lines[0]).toBe("1");
      expect(lines[1]).toBe("00:00:00,000 --> 00:00:02,500");
      expect(lines[2]).toBe("Hello world");
      expect(lines[3]).toBe("");
      // Second entry
      expect(lines[4]).toBe("2");
      expect(lines[5]).toBe("00:00:03,000 --> 00:00:05,800");
      expect(lines[6]).toBe("你好世界");
    });
  });

  describe("exportMarkdown", () => {
    it("exports markdown with title and timestamps", () => {
      const result = exportMarkdown(mockSession, mockSegments);
      expect(result).toContain("## Test Session");
      expect(result).toContain("**00:00:00**");
      expect(result).toContain("Hello world");
      expect(result).toContain("你好世界");
    });
  });
});
