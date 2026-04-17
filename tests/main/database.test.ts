import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createDatabase,
  createSession,
  getSession,
  listSessions,
  addSegment,
  getSegments,
  updateSession,
  reorderSessions,
  saveTranslation,
  getTranslations,
  addSummary,
  getSummaries,
  deleteSession,
  migrateUtcToLocal,
  createDownload,
  updateDownload,
} from '../../src/main/database'
import fs from 'fs'
import path from 'path'
import os from 'os'
import Database from 'better-sqlite3'

describe('database', () => {
  let dbPath: string
  let db: ReturnType<typeof createDatabase>

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `capty-test-${Date.now()}.db`)
    db = createDatabase(dbPath)
  })
  afterEach(() => {
    db.close()
    fs.unlinkSync(dbPath)
  })

  it('creates tables on init', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
    const names = tables.map((t: any) => t.name)
    expect(names).toContain('sessions')
    expect(names).toContain('segments')
  })

  it('creates and retrieves a session', () => {
    const id = createSession(db, { modelName: 'Qwen3-ASR-0.6B' })
    const session = getSession(db, id)
    expect(session.model_name).toBe('Qwen3-ASR-0.6B')
    expect(session.status).toBe('recording')
  })

  it('adds segments to a session', () => {
    const sessionId = createSession(db, { modelName: 'test-model' })
    addSegment(db, {
      sessionId,
      startTime: 0.0,
      endTime: 2.5,
      text: 'hello world',
      audioPath: '001.wav',
      isFinal: true
    })
    const segments = getSegments(db, sessionId)
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('hello world')
  })

  it('lists sessions ordered by most recent', () => {
    createSession(db, { modelName: 'model-a' })
    createSession(db, { modelName: 'model-b' })
    const sessions = listSessions(db)
    expect(sessions).toHaveLength(2)
  })

  it('updates session status', () => {
    const id = createSession(db, { modelName: 'test' })
    updateSession(db, id, { status: 'completed', durationSeconds: 120 })
    const session = getSession(db, id)
    expect(session.status).toBe('completed')
    expect(session.duration_seconds).toBe(120)
  })

  it('reorders sessions by sort_order descending', () => {
    const a = createSession(db, { modelName: 'model-a' })
    const b = createSession(db, { modelName: 'model-b' })
    const c = createSession(db, { modelName: 'model-c' })

    reorderSessions(db, [b, c, a])

    const sessions = listSessions(db)
    expect(sessions.map((s) => s.id)).toEqual([b, c, a])
    expect(sessions[0].sort_order).toBe(3)
    expect(sessions[1].sort_order).toBe(2)
    expect(sessions[2].sort_order).toBe(1)
  })

  it('upserts translations by segment and language', () => {
    const sessionId = createSession(db, { modelName: 'test-model' })
    const segmentId = addSegment(db, {
      sessionId,
      startTime: 0,
      endTime: 1,
      text: 'hello',
      audioPath: '001.wav',
      isFinal: true
    })

    saveTranslation(db, {
      segmentId,
      sessionId,
      targetLanguage: 'zh',
      translatedText: '你好'
    })
    saveTranslation(db, {
      segmentId,
      sessionId,
      targetLanguage: 'zh',
      translatedText: '您好'
    })

    const translations = getTranslations(db, sessionId, 'zh')
    expect(translations).toHaveLength(1)
    expect(translations[0].translated_text).toBe('您好')
  })

  it('deleteSession cascades segments, summaries, and translations', () => {
    const sessionId = createSession(db, { modelName: 'test-model' })
    const segmentId = addSegment(db, {
      sessionId,
      startTime: 0,
      endTime: 1,
      text: 'hello',
      audioPath: '001.wav',
      isFinal: true
    })
    addSummary(db, {
      sessionId,
      content: 'summary',
      modelName: 'gpt-test',
      providerId: 'provider',
      promptType: 'summarize'
    })
    saveTranslation(db, {
      segmentId,
      sessionId,
      targetLanguage: 'zh',
      translatedText: '你好'
    })

    deleteSession(db, sessionId)

    expect(getSession(db, sessionId)).toBeUndefined()
    expect(getSegments(db, sessionId)).toEqual([])
    expect(getSummaries(db, sessionId)).toEqual([])
    expect(getTranslations(db, sessionId, 'zh')).toEqual([])
  })

  it('migrates UTC timestamps and audio paths to local time once', () => {
    db.exec(`
      INSERT INTO sessions (
        id, title, started_at, ended_at, audio_path, model_name, status
      ) VALUES (
        1,
        '2026-04-17 08:00:00',
        '2026-04-17 00:00:00',
        '2026-04-17 01:00:00',
        '2026-04-17T00-00-00',
        'test-model',
        'completed'
      )
    `)
    db.exec(`
      INSERT INTO summaries (
        session_id, content, model_name, provider_id, prompt_type, created_at
      ) VALUES (
        1, 'summary', 'gpt-test', 'provider', 'summarize', '2026-04-17 00:30:00'
      )
    `)
    db.pragma('user_version = 0')

    const renames = migrateUtcToLocal(db)
    const session = getSession(db, 1)!
    const expectedDate = new Date(Date.UTC(2026, 3, 17, 0, 0, 0))
    const pad = (n: number) => String(n).padStart(2, '0')
    const expectedPath = `${expectedDate.getFullYear()}-${pad(expectedDate.getMonth() + 1)}-${pad(expectedDate.getDate())}T${pad(expectedDate.getHours())}-${pad(expectedDate.getMinutes())}-${pad(expectedDate.getSeconds())}`

    expect(renames).toEqual([
      { id: 1, oldPath: '2026-04-17T00-00-00', newPath: expectedPath }
    ])
    expect(session.audio_path).toBe(expectedPath)
    expect(db.pragma('user_version', { simple: true })).toBe(2)
  })

  it('fixes orphaned recording sessions on database open', () => {
    db.close()

    const raw = new Database(dbPath)
    raw.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        started_at DATETIME,
        ended_at DATETIME,
        duration_seconds INTEGER,
        audio_path TEXT,
        model_name TEXT NOT NULL,
        status TEXT DEFAULT 'recording'
      )
    `)
    raw.exec(`
      CREATE TABLE IF NOT EXISTS segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        text TEXT NOT NULL,
        audio_path TEXT NOT NULL,
        is_final INTEGER NOT NULL DEFAULT 0
      )
    `)
    raw.exec(`
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        model_name TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        prompt_type TEXT NOT NULL DEFAULT 'summarize',
        created_at DATETIME
      )
    `)
    raw.exec(`
      INSERT INTO sessions (title, started_at, model_name, status)
      VALUES ('orphan', '2026-04-17 10:00:00', 'test-model', 'recording')
    `)
    raw.close()

    db = createDatabase(dbPath)
    const sessions = listSessions(db)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].status).toBe('completed')
    expect(sessions[0].ended_at).not.toBeNull()
  })

  it('rejects invalid download update columns', () => {
    const id = createDownload(db, { url: 'https://example.com', source: 'example.com' })

    expect(() =>
      updateDownload(db, id, { bogus: 'value' } as any)
    ).toThrow('Invalid column name: bogus')
  })
})
