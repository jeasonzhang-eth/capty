interface Segment {
  readonly id: number;
  readonly start_time: number;
  readonly end_time: number;
  readonly text: string;
}

/**
 * Convert Segment[] to LRC format string.
 * Each segment maps 1:1 to an LRC line by index.
 */
export function segmentsToLrc(segments: readonly Segment[]): string {
  return segments
    .map((seg) => {
      const mm = String(Math.floor(seg.start_time / 60)).padStart(2, "0");
      const ss = (seg.start_time % 60).toFixed(2).padStart(5, "0");
      return `[${mm}:${ss}]${seg.text}`;
    })
    .join("\n");
}
