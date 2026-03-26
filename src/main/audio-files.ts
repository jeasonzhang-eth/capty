import fs from "fs";
import path from "path";

/**
 * Returns the session directory path for audio files.
 * Structure: <dataDir>/audio/<sessionTimestamp>/
 */
export function getSessionDir(
  dataDir: string,
  sessionTimestamp: string,
): string {
  return path.join(dataDir, "audio", sessionTimestamp);
}

/**
 * Creates a valid WAV file buffer by prepending a standard
 * 44-byte RIFF/WAVE header to raw PCM data.
 */
export function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate: number,
  channels: number,
  bitDepth: number,
): Buffer {
  const dataSize = pcmBuffer.length;
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const header = Buffer.alloc(headerSize);

  // RIFF chunk descriptor
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize - 8, 4);
  header.write("WAVE", 8);

  // fmt sub-chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // sub-chunk size (16 for PCM)
  header.writeUInt16LE(1, 20); // audio format (1 = PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);

  // data sub-chunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Saves a segment of PCM audio as a WAV file in the segments directory.
 * File name is zero-padded to 3 digits (e.g., 001.wav, 002.wav).
 */
export function saveSegmentAudio(
  sessionDir: string,
  segmentIndex: number,
  pcmBuffer: Buffer,
): void {
  const segmentsDir = path.join(sessionDir, "segments");
  fs.mkdirSync(segmentsDir, { recursive: true });

  const fileName = String(segmentIndex).padStart(3, "0") + ".wav";
  const wavBuffer = pcmToWav(pcmBuffer, 16000, 1, 16);
  fs.writeFileSync(path.join(segmentsDir, fileName), wavBuffer);
}

/**
 * Saves the full session PCM audio as a WAV file.
 * Uses the given filename (defaults to 'full.wav' for backward compat).
 */
export function saveFullAudio(
  sessionDir: string,
  pcmBuffer: Buffer,
  fileName: string = "full.wav",
): void {
  fs.mkdirSync(sessionDir, { recursive: true });

  const wavBuffer = pcmToWav(pcmBuffer, 16000, 1, 16);
  fs.writeFileSync(path.join(sessionDir, fileName), wavBuffer);
}

/**
 * Deletes the entire session audio directory recursively.
 */
export function deleteSessionAudio(sessionDir: string): void {
  fs.rmSync(sessionDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Streaming audio writer — writes PCM data to disk during recording so that
// audio survives abnormal exits (crash, dev reload, force quit).
// ---------------------------------------------------------------------------

const WAV_HEADER_SIZE = 44;

let streamFd: number | null = null;
let streamDataBytes: number = 0;

/**
 * Open a WAV file for streaming writes.  Writes a placeholder header;
 * PCM data is appended via `appendAudioStream`, and the header is
 * finalised by `finalizeAudioStream` (or `repairWavHeaders` on restart).
 */
export function openAudioStream(sessionDir: string, fileName: string): void {
  // Close any previously leaked stream
  if (streamFd !== null) {
    try {
      fs.closeSync(streamFd);
    } catch {
      /* ignore */
    }
  }

  fs.mkdirSync(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, fileName);

  // Open for read+write so we can seek back to fix the header later
  streamFd = fs.openSync(filePath, "w+");
  streamDataBytes = 0;

  // Write a 44-byte WAV header with placeholder sizes (will be fixed on close)
  const header = buildWavHeader(0);
  fs.writeSync(streamFd, header, 0, WAV_HEADER_SIZE, 0);
}

/**
 * Append raw 16-bit PCM data to the currently open stream.
 * No-op if no stream is open.
 */
export function appendAudioStream(pcmBuffer: Buffer): void {
  if (streamFd === null) return;
  fs.writeSync(streamFd, pcmBuffer);
  streamDataBytes += pcmBuffer.length;
}

/**
 * Finalize the open stream: fix the WAV header sizes and close the file.
 */
export function finalizeAudioStream(): void {
  if (streamFd === null) return;

  // Patch RIFF chunk size (offset 4) and data chunk size (offset 40)
  const buf4 = Buffer.alloc(4);

  buf4.writeUInt32LE(WAV_HEADER_SIZE - 8 + streamDataBytes, 0);
  fs.writeSync(streamFd, buf4, 0, 4, 4);

  buf4.writeUInt32LE(streamDataBytes, 0);
  fs.writeSync(streamFd, buf4, 0, 4, 40);

  fs.closeSync(streamFd);
  streamFd = null;
  streamDataBytes = 0;
}

/**
 * Scan an audio directory and repair any WAV files that have placeholder
 * headers (data size = 0 but file is larger than 44 bytes).
 * Called on startup to recover from abnormal exits.
 */
export function repairWavHeaders(audioBaseDir: string): number {
  if (!fs.existsSync(audioBaseDir)) return 0;

  let repaired = 0;

  for (const sessionName of fs.readdirSync(audioBaseDir)) {
    const sessionDir = path.join(audioBaseDir, sessionName);
    if (!fs.statSync(sessionDir).isDirectory()) continue;

    for (const file of fs.readdirSync(sessionDir)) {
      if (!file.endsWith(".wav")) continue;
      const filePath = path.join(sessionDir, file);
      const stat = fs.statSync(filePath);

      // Only repair files that have data beyond the header
      if (stat.size <= WAV_HEADER_SIZE) continue;

      // Read current header
      const fd = fs.openSync(filePath, "r+");
      const header = Buffer.alloc(WAV_HEADER_SIZE);
      fs.readSync(fd, header, 0, WAV_HEADER_SIZE, 0);

      // Check if it's a RIFF/WAVE file with wrong sizes
      if (header.toString("ascii", 0, 4) !== "RIFF") {
        fs.closeSync(fd);
        continue;
      }

      const storedDataSize = header.readUInt32LE(40);
      const actualDataSize = stat.size - WAV_HEADER_SIZE;

      if (storedDataSize === 0 && actualDataSize > 0) {
        // Fix the header
        const buf4 = Buffer.alloc(4);

        buf4.writeUInt32LE(WAV_HEADER_SIZE - 8 + actualDataSize, 0);
        fs.writeSync(fd, buf4, 0, 4, 4);

        buf4.writeUInt32LE(actualDataSize, 0);
        fs.writeSync(fd, buf4, 0, 4, 40);

        repaired++;
        console.log(
          `[audio] Repaired WAV header: ${filePath} (${actualDataSize} bytes)`,
        );
      }

      fs.closeSync(fd);
    }
  }

  return repaired;
}

function buildWavHeader(dataSize: number): Buffer {
  const header = Buffer.alloc(WAV_HEADER_SIZE);
  header.write("RIFF", 0);
  header.writeUInt32LE(WAV_HEADER_SIZE - 8 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24); // sample rate
  header.writeUInt32LE(32000, 28); // byte rate (16kHz * 1ch * 16bit/8)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return header;
}
