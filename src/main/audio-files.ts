import fs from 'fs'
import path from 'path'

/**
 * Returns the session directory path for audio files.
 * Structure: <dataDir>/audio/<sessionTimestamp>/
 */
export function getSessionDir(dataDir: string, sessionTimestamp: string): string {
  return path.join(dataDir, 'audio', sessionTimestamp)
}

/**
 * Creates a valid WAV file buffer by prepending a standard
 * 44-byte RIFF/WAVE header to raw PCM data.
 */
export function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate: number,
  channels: number,
  bitDepth: number
): Buffer {
  const dataSize = pcmBuffer.length
  const byteRate = sampleRate * channels * (bitDepth / 8)
  const blockAlign = channels * (bitDepth / 8)
  const headerSize = 44
  const fileSize = headerSize + dataSize

  const header = Buffer.alloc(headerSize)

  // RIFF chunk descriptor
  header.write('RIFF', 0)
  header.writeUInt32LE(fileSize - 8, 4)
  header.write('WAVE', 8)

  // fmt sub-chunk
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // sub-chunk size (16 for PCM)
  header.writeUInt16LE(1, 20) // audio format (1 = PCM)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitDepth, 34)

  // data sub-chunk
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcmBuffer])
}

/**
 * Saves a segment of PCM audio as a WAV file in the segments directory.
 * File name is zero-padded to 3 digits (e.g., 001.wav, 002.wav).
 */
export function saveSegmentAudio(
  sessionDir: string,
  segmentIndex: number,
  pcmBuffer: Buffer
): void {
  const segmentsDir = path.join(sessionDir, 'segments')
  fs.mkdirSync(segmentsDir, { recursive: true })

  const fileName = String(segmentIndex).padStart(3, '0') + '.wav'
  const wavBuffer = pcmToWav(pcmBuffer, 16000, 1, 16)
  fs.writeFileSync(path.join(segmentsDir, fileName), wavBuffer)
}

/**
 * Saves the full session PCM audio as a WAV file named full.wav.
 */
export function saveFullAudio(sessionDir: string, pcmBuffer: Buffer): void {
  fs.mkdirSync(sessionDir, { recursive: true })

  const wavBuffer = pcmToWav(pcmBuffer, 16000, 1, 16)
  fs.writeFileSync(path.join(sessionDir, 'full.wav'), wavBuffer)
}

/**
 * Deletes the entire session audio directory recursively.
 */
export function deleteSessionAudio(sessionDir: string): void {
  fs.rmSync(sessionDir, { recursive: true, force: true })
}
