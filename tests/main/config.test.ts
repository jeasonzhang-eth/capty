import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readConfig, writeConfig, getDataDir } from '../../src/main/config'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('config', () => {
  const testConfigDir = path.join(os.tmpdir(), '.capty-test-' + Date.now())

  beforeEach(() => { fs.mkdirSync(testConfigDir, { recursive: true }) })
  afterEach(() => { fs.rmSync(testConfigDir, { recursive: true, force: true }) })

  it('returns default config when no file exists', () => {
    const config = readConfig(testConfigDir)
    expect(config.dataDir).toBe(null)
  })

  it('writes and reads config', () => {
    writeConfig(testConfigDir, { dataDir: '/tmp/capty-data' })
    const config = readConfig(testConfigDir)
    expect(config.dataDir).toBe('/tmp/capty-data')
  })

  it('getDataDir returns configured path', () => {
    writeConfig(testConfigDir, { dataDir: '/tmp/capty-data' })
    expect(getDataDir(testConfigDir)).toBe('/tmp/capty-data')
  })
})
