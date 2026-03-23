import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createDatabase,
  createSession,
  getSession,
  listSessions,
  addSegment,
  getSegments,
  updateSession
} from '../../src/main/database'
import fs from 'fs'
import path from 'path'
import os from 'os'

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
})
