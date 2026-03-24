import Database from "better-sqlite3";

export interface CreateSessionOpts {
  readonly modelName: string;
}

export interface AddSegmentOpts {
  readonly sessionId: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
  readonly audioPath: string;
  readonly isFinal: boolean;
}

export interface UpdateSessionFields {
  readonly status?: string;
  readonly durationSeconds?: number;
  readonly title?: string;
  readonly audioPath?: string;
  readonly endedAt?: string;
}

function initTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT (datetime('now', 'localtime')),
      started_at DATETIME DEFAULT (datetime('now')),
      ended_at DATETIME,
      duration_seconds INTEGER,
      audio_path TEXT,
      model_name TEXT NOT NULL,
      status TEXT DEFAULT 'recording'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      text TEXT NOT NULL,
      audio_path TEXT NOT NULL,
      is_final INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);
}

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initTables(db);
  return db;
}

export function createSession(
  db: Database.Database,
  opts: CreateSessionOpts,
): number {
  const stmt = db.prepare("INSERT INTO sessions (model_name) VALUES (?)");
  const result = stmt.run(opts.modelName);
  return result.lastInsertRowid as number;
}

export function getSession(db: Database.Database, id: number): any {
  const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  return stmt.get(id);
}

export function listSessions(db: Database.Database): any[] {
  const stmt = db.prepare("SELECT * FROM sessions ORDER BY started_at DESC");
  return stmt.all();
}

export function addSegment(
  db: Database.Database,
  opts: AddSegmentOpts,
): number {
  const stmt = db.prepare(
    "INSERT INTO segments (session_id, start_time, end_time, text, audio_path, is_final) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const result = stmt.run(
    opts.sessionId,
    opts.startTime,
    opts.endTime,
    opts.text,
    opts.audioPath,
    opts.isFinal ? 1 : 0,
  );
  return result.lastInsertRowid as number;
}

export function getSegments(db: Database.Database, sessionId: number): any[] {
  const stmt = db.prepare(
    "SELECT * FROM segments WHERE session_id = ? ORDER BY start_time ASC",
  );
  return stmt.all(sessionId);
}

export function deleteSegmentsBySession(
  db: Database.Database,
  sessionId: number,
): void {
  db.prepare("DELETE FROM segments WHERE session_id = ?").run(sessionId);
}

export function deleteSession(db: Database.Database, id: number): void {
  deleteSegmentsBySession(db, id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function updateSession(
  db: Database.Database,
  id: number,
  fields: UpdateSessionFields,
): void {
  const setClauses: string[] = [];
  const values: any[] = [];

  if (fields.status !== undefined) {
    setClauses.push("status = ?");
    values.push(fields.status);
  }
  if (fields.durationSeconds !== undefined) {
    setClauses.push("duration_seconds = ?");
    values.push(fields.durationSeconds);
  }
  if (fields.title !== undefined) {
    setClauses.push("title = ?");
    values.push(fields.title);
  }
  if (fields.audioPath !== undefined) {
    setClauses.push("audio_path = ?");
    values.push(fields.audioPath);
  }
  if (fields.endedAt !== undefined) {
    setClauses.push("ended_at = ?");
    values.push(fields.endedAt);
  }

  if (setClauses.length === 0) {
    return;
  }

  const sql = `UPDATE sessions SET ${setClauses.join(", ")} WHERE id = ?`;
  values.push(id);
  db.prepare(sql).run(...values);
}
