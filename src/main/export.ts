interface Session {
  readonly id: number;
  readonly title: string;
  readonly started_at: string;
  readonly duration_seconds: number;
}

interface Segment {
  readonly id: number;
  readonly start_time: number;
  readonly end_time: number;
  readonly text: string;
}

interface TxtExportOptions {
  readonly timestamps: boolean;
}

type TimecodeFormat = "srt" | "simple";

function padTwo(n: number): string {
  return n.toString().padStart(2, "0");
}

function padThree(n: number): string {
  return n.toString().padStart(3, "0");
}

export function formatTimecode(
  seconds: number,
  format: TimecodeFormat,
): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const milliseconds = Math.round((seconds - totalSeconds) * 1000);

  const base = `${padTwo(hours)}:${padTwo(minutes)}:${padTwo(secs)}`;

  if (format === "srt") {
    return `${base},${padThree(milliseconds)}`;
  }

  return base;
}

export function exportTXT(
  _session: Session,
  segments: readonly Segment[],
  options: TxtExportOptions,
): string {
  return segments
    .map((segment) => {
      if (options.timestamps) {
        const timecode = formatTimecode(segment.start_time, "simple");
        return `[${timecode}] ${segment.text}`;
      }
      return segment.text;
    })
    .join("\n");
}

export function exportSRT(
  _session: Session,
  segments: readonly Segment[],
): string {
  return segments
    .map((segment, index) => {
      const start = formatTimecode(segment.start_time, "srt");
      const end = formatTimecode(segment.end_time, "srt");
      return `${index + 1}\n${start} --> ${end}\n${segment.text}`;
    })
    .join("\n\n");
}

export function exportMarkdown(
  session: Session,
  segments: readonly Segment[],
): string {
  const header = `## ${session.title}`;
  const body = segments
    .map((segment) => {
      const timecode = formatTimecode(segment.start_time, "simple");
      return `**${timecode}** ${segment.text}`;
    })
    .join("\n\n");

  return `${header}\n\n${body}`;
}
