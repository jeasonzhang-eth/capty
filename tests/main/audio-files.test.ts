import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getSessionDir, saveSegmentAudio, saveFullAudio, deleteSessionAudio, pcmToWav } from '../../src/main/audio-files'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('audio-files', () => {
  let testDataDir: string

  beforeEach(() => {
    testDataDir = path.join(os.tmpdir(), `capty-audio-test-${Date.now()}`)
    fs.mkdirSync(testDataDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true })
  })

  it('getSessionDir returns correct path', () => {
    const dir = getSessionDir(testDataDir, '2026-03-23_143201')
    expect(dir).toBe(path.join(testDataDir, 'audio', '2026-03-23_143201'))
  })

  it('saveSegmentAudio writes WAV file to segments directory', () => {
    const sessionDir = getSessionDir(testDataDir, '2026-03-23_143201')
    const pcm = Buffer.alloc(3200) // 100ms of 16kHz 16-bit mono
    saveSegmentAudio(sessionDir, 1, pcm)
    const wavPath = path.join(sessionDir, 'segments', '001.wav')
    expect(fs.existsSync(wavPath)).toBe(true)
    // WAV header starts with RIFF
    const header = fs.readFileSync(wavPath).slice(0, 4).toString()
    expect(header).toBe('RIFF')
  })

  it('saveFullAudio writes WAV file as full.wav', () => {
    const sessionDir = getSessionDir(testDataDir, '2026-03-23_143201')
    const pcm = Buffer.alloc(32000) // 1s of audio
    saveFullAudio(sessionDir, pcm)
    const wavPath = path.join(sessionDir, 'full.wav')
    expect(fs.existsSync(wavPath)).toBe(true)
    const header = fs.readFileSync(wavPath).slice(0, 4).toString()
    expect(header).toBe('RIFF')
  })

  it('deleteSessionAudio removes entire session directory', () => {
    const sessionDir = getSessionDir(testDataDir, '2026-03-23_143201')
    const pcm = Buffer.alloc(3200)
    saveSegmentAudio(sessionDir, 1, pcm)
    expect(fs.existsSync(sessionDir)).toBe(true)
    deleteSessionAudio(sessionDir)
    expect(fs.existsSync(sessionDir)).toBe(false)
  })

  it('pcmToWav wraps PCM in valid WAV header', () => {
    const pcm = Buffer.alloc(160) // 10 samples stereo
    const wav = pcmToWav(pcm, 16000, 1, 16)
    expect(wav.slice(0, 4).toString()).toBe('RIFF')
    expect(wav.slice(8, 12).toString()).toBe('WAVE')
    // Total size: 44 header + PCM data
    expect(wav.length).toBe(44 + pcm.length)
  })
})
