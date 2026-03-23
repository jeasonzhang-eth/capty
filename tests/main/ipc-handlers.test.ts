import { describe, it, expect, vi, beforeEach } from 'vitest'

// Collect registered IPC handlers for testing
const handlers = new Map<string, (...args: any[]) => any>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler)
    })
  },
  dialog: {
    showOpenDialog: vi.fn()
  },
  BrowserWindow: vi.fn()
}))

// Must import after mocks are set up
import { registerIpcHandlers } from '../../src/main/ipc-handlers'
import { ipcMain, dialog } from 'electron'

// Create mock dependencies
function createMockDb() {
  return {
    prepare: vi.fn().mockReturnValue({
      run: vi.fn().mockReturnValue({ lastInsertRowid: 1 }),
      get: vi.fn().mockReturnValue({ id: 1, model_name: 'test-model', status: 'recording' }),
      all: vi.fn().mockReturnValue([
        { id: 1, model_name: 'test-model', status: 'recording' }
      ])
    }),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn()
  } as any
}

function createMockSidecar() {
  return {
    getUrl: vi.fn().mockReturnValue('http://localhost:9999'),
    getPort: vi.fn().mockReturnValue(9999),
    isReady: vi.fn().mockReturnValue(true),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn()
  } as any
}

function createMockMainWindow() {
  return {
    webContents: { send: vi.fn() }
  } as any
}

describe('registerIpcHandlers', () => {
  let mockDb: any
  let mockSidecar: any
  let mockMainWindow: any

  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()

    mockDb = createMockDb()
    mockSidecar = createMockSidecar()
    mockMainWindow = createMockMainWindow()

    registerIpcHandlers({
      db: mockDb,
      configDir: '/tmp/test-config',
      sidecar: mockSidecar,
      getMainWindow: () => mockMainWindow
    })
  })

  it('registers all expected IPC channels', () => {
    const expectedChannels = [
      'session:create',
      'session:list',
      'session:get',
      'session:update',
      'segment:add',
      'audio:save-segment',
      'audio:save-full',
      'export:txt',
      'export:srt',
      'export:markdown',
      'config:get',
      'config:set',
      'sidecar:get-url',
      'models:list',
      'app:get-data-dir',
      'app:select-directory'
    ]

    for (const channel of expectedChannels) {
      expect(handlers.has(channel), `channel "${channel}" should be registered`).toBe(true)
    }

    expect(ipcMain.handle).toHaveBeenCalledTimes(expectedChannels.length)
  })

  describe('session:create', () => {
    it('creates a session and returns the id', async () => {
      const handler = handlers.get('session:create')!
      const result = await handler({} as any, 'Qwen3-ASR-0.6B')
      expect(result).toBe(1)
    })
  })

  describe('session:list', () => {
    it('lists all sessions', async () => {
      const handler = handlers.get('session:list')!
      const result = await handler({} as any)
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('session:get', () => {
    it('gets a session by id', async () => {
      const handler = handlers.get('session:get')!
      const result = await handler({} as any, 1)
      expect(result).toBeDefined()
      expect(result.id).toBe(1)
    })
  })

  describe('session:update', () => {
    it('updates session fields', async () => {
      const handler = handlers.get('session:update')!
      await handler({} as any, 1, { status: 'completed' })
      // updateSession does not return a value, just verify no error
    })
  })

  describe('segment:add', () => {
    it('adds a segment and returns the id', async () => {
      const handler = handlers.get('segment:add')!
      const result = await handler({} as any, {
        sessionId: 1,
        startTime: 0,
        endTime: 2.5,
        text: 'hello',
        audioPath: '001.wav',
        isFinal: true
      })
      expect(result).toBe(1)
    })
  })

  describe('config:get', () => {
    it('returns the app config', async () => {
      const handler = handlers.get('config:get')!
      const result = await handler({} as any)
      // readConfig returns an object with dataDir
      expect(result).toHaveProperty('dataDir')
    })
  })

  describe('config:set', () => {
    it('writes the config', async () => {
      const handler = handlers.get('config:set')!
      // writeConfig writes to disk; we just verify no error
      await handler({} as any, { dataDir: '/tmp/new-data' })
    })
  })

  describe('sidecar:get-url', () => {
    it('returns the sidecar URL', async () => {
      const handler = handlers.get('sidecar:get-url')!
      const result = await handler({} as any)
      expect(result).toBe('http://localhost:9999')
    })
  })

  describe('models:list', () => {
    it('fetches models from sidecar HTTP API', async () => {
      const mockModels = [{ name: 'model-a' }, { name: 'model-b' }]
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockModels
      }))

      const handler = handlers.get('models:list')!
      const result = await handler({} as any)
      expect(result).toEqual(mockModels)

      vi.unstubAllGlobals()
    })
  })

  describe('app:get-data-dir', () => {
    it('returns the data directory', async () => {
      const handler = handlers.get('app:get-data-dir')!
      const result = await handler({} as any)
      // getDataDir reads config and returns dataDir (null by default)
      expect(result).toBeDefined()
    })
  })

  describe('app:select-directory', () => {
    it('returns selected directory path', async () => {
      const mockedDialog = vi.mocked(dialog.showOpenDialog)
      mockedDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/test/data'] })

      const handler = handlers.get('app:select-directory')!
      const result = await handler({} as any)
      expect(result).toBe('/Users/test/data')
    })

    it('returns null when dialog is canceled', async () => {
      const mockedDialog = vi.mocked(dialog.showOpenDialog)
      mockedDialog.mockResolvedValue({ canceled: true, filePaths: [] })

      const handler = handlers.get('app:select-directory')!
      const result = await handler({} as any)
      expect(result).toBeNull()
    })
  })
})
