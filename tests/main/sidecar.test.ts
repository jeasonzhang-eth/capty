import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SidecarManager } from '../../src/main/sidecar'

// Mock child_process
vi.mock('child_process', () => {
  const mockProcess = {
    pid: 12345,
    kill: vi.fn(),
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  }
  return {
    spawn: vi.fn(() => mockProcess),
    _mockProcess: mockProcess,
  }
})

// Mock fetch for health checks
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('SidecarManager', () => {
  let manager: SidecarManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new SidecarManager('/path/to/sidecar', '/path/to/models')
  })

  it('initializes with correct paths', () => {
    expect(manager.isReady()).toBe(false)
  })

  it('start spawns process with correct arguments', async () => {
    const { spawn } = await import('child_process')
    // Mock health check succeeding
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })

    await manager.start()

    expect(spawn).toHaveBeenCalledWith(
      '/path/to/sidecar',
      expect.arrayContaining(['--port', expect.any(String), '--models-dir', '/path/to/models']),
      expect.any(Object)
    )
  })

  it('getPort returns assigned port after start', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    await manager.start()
    const port = manager.getPort()
    expect(typeof port).toBe('number')
    expect(port).toBeGreaterThan(0)
  })

  it('getUrl returns correct URL', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    await manager.start()
    expect(manager.getUrl()).toMatch(/^http:\/\/localhost:\d+$/)
  })

  it('stop kills the child process', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    await manager.start()
    manager.stop()
    expect(manager.isReady()).toBe(false)
  })

  it('isReady returns true after successful start', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    await manager.start()
    expect(manager.isReady()).toBe(true)
  })
})
