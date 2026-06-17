import { spawn } from "../shared/spawn";

/**
 * Concatenate several audio files into a single canonical WAV
 * (16 kHz / mono / 16-bit) in one ffmpeg pass. Output order matches the
 * order of `orderedPaths`. Inputs may be any ffmpeg-readable format.
 */
export function mergeAudioFiles(
  orderedPaths: readonly string[],
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (orderedPaths.length < 2) {
      reject(new Error("mergeAudioFiles requires at least 2 input files"));
      return;
    }

    const inputs = orderedPaths.flatMap((p) => ["-i", p]);
    const labels = orderedPaths.map((_, i) => `[${i}:a]`).join("");
    const filter = `${labels}concat=n=${orderedPaths.length}:v=0:a=1[out]`;

    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      ...inputs,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-sample_fmt",
      "s16",
      "-f",
      "wav",
      "-y",
      outputPath,
    ]);

    ffmpeg.on("close", (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat exited with code ${code}`));
    });
    ffmpeg.on("error", (err: Error) => {
      reject(
        new Error(
          `Failed to run ffmpeg. Make sure ffmpeg is installed (brew install ffmpeg). ${err.message}`,
        ),
      );
    });
  });
}
