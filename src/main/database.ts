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

export interface AddSummaryOpts {
  readonly sessionId: number;
  readonly content: string;
  readonly modelName: string;
  readonly providerId: string;
  readonly promptType: string;
}

export interface UpdateSessionFields {
  readonly status?: string;
  readonly durationSeconds?: number;
  readonly title?: string;
  readonly audioPath?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
}

function initTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT (datetime('now', 'localtime')),
      started_at DATETIME DEFAULT (datetime('now', 'localtime')),
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      model_name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      prompt_type TEXT NOT NULL DEFAULT 'summarize',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  // Migrate: add prompt_type column for existing databases
  try {
    db.exec(
      "ALTER TABLE summaries ADD COLUMN prompt_type TEXT NOT NULL DEFAULT 'summarize'",
    );
  } catch {
    // Column already exists — ignore
  }
}

export function createDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initTables(db);
  fixOrphanedRecordings(db);
  return db;
}

/**
 * Migrate old UTC timestamps to local time.
 * Returns audio paths that need directory renaming on disk.
 */
export function migrateUtcToLocal(
  db: Database.Database,
): { id: number; oldPath: string; newPath: string }[] {
  const version = db.pragma("user_version", { simple: true }) as number;

  let renames: { id: number; oldPath: string; newPath: string }[] = [];

  if (version < 1) {
    const migrate = db.transaction(() => {
      // Convert UTC → local for sessions (title was ALREADY local, skip it)
      db.exec(`
        UPDATE sessions SET
          started_at = datetime(started_at, 'localtime'),
          ended_at = CASE WHEN ended_at IS NOT NULL
                          THEN datetime(ended_at, 'localtime') ELSE NULL END
      `);

      // Convert UTC → local for summaries
      db.exec(
        "UPDATE summaries SET created_at = datetime(created_at, 'localtime')",
      );

      // Collect audio paths that need renaming (timestamp-format only)
      const sessions = db
        .prepare(
          "SELECT id, audio_path FROM sessions WHERE audio_path IS NOT NULL AND audio_path GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]-[0-9][0-9]-[0-9][0-9]'",
        )
        .all() as { id: number; audio_path: string }[];

      const result: { id: number; oldPath: string; newPath: string }[] = [];
      const pad = (n: number): string => String(n).padStart(2, "0");

      for (const s of sessions) {
        const m = s.audio_path.match(
          /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/,
        );
        if (!m) continue;

        const utcDate = new Date(
          Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
        );
        const newPath = `${utcDate.getFullYear()}-${pad(utcDate.getMonth() + 1)}-${pad(utcDate.getDate())}T${pad(utcDate.getHours())}-${pad(utcDate.getMinutes())}-${pad(utcDate.getSeconds())}`;

        if (newPath !== s.audio_path) {
          result.push({ id: s.id, oldPath: s.audio_path, newPath });
        }
      }

      // Update audio_path in DB
      const updateStmt = db.prepare(
        "UPDATE sessions SET audio_path = ? WHERE id = ?",
      );
      for (const r of result) {
        updateStmt.run(r.newPath, r.id);
      }

      db.pragma("user_version = 2");
      return result;
    });

    renames = migrate();
    console.log(
      `[db] Migrated UTC timestamps to local time (${renames.length} audio path(s) to rename)`,
    );
  }

  // v2: Fix titles that were incorrectly converted by v1
  // (title column always used datetime('now','localtime'), was already local)
  if (version === 1) {
    db.exec(`
      UPDATE sessions SET title = datetime(title, 'utc')
      WHERE title GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
    `);
    db.pragma("user_version = 2");
    console.log("[db] Fixed titles incorrectly shifted by v1 migration");
  }

  return renames;
}

/**
 * Fix sessions stuck in 'recording' status due to abnormal exit
 * (e.g. crash, dev server restart, force quit).
 */
function fixOrphanedRecordings(db: Database.Database): void {
  const result = db
    .prepare(
      "UPDATE sessions SET status = 'completed', ended_at = COALESCE(ended_at, datetime('now', 'localtime')) WHERE status = 'recording'",
    )
    .run();
  if (result.changes > 0) {
    console.log(`[db] Fixed ${result.changes} orphaned recording session(s)`);
  }
}

export function createSession(
  db: Database.Database,
  opts: CreateSessionOpts,
): number {
  // Explicitly set started_at and title to local time instead of relying on
  // DEFAULT, because existing databases may have an older DEFAULT that stores
  // UTC (CREATE TABLE IF NOT EXISTS won't update the DEFAULT expression).
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const localTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const stmt = db.prepare(
    "INSERT INTO sessions (model_name, started_at, title) VALUES (?, ?, ?)",
  );
  const result = stmt.run(opts.modelName, localTime, localTime);
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
  deleteSummariesBySession(db, id);
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
  if (fields.startedAt !== undefined) {
    setClauses.push("started_at = ?");
    values.push(fields.startedAt);
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

export function addSummary(
  db: Database.Database,
  opts: AddSummaryOpts,
): number {
  const stmt = db.prepare(
    "INSERT INTO summaries (session_id, content, model_name, provider_id, prompt_type) VALUES (?, ?, ?, ?, ?)",
  );
  const result = stmt.run(
    opts.sessionId,
    opts.content,
    opts.modelName,
    opts.providerId,
    opts.promptType,
  );
  return result.lastInsertRowid as number;
}

export function getSummaries(
  db: Database.Database,
  sessionId: number,
  promptType?: string,
): any[] {
  if (promptType) {
    const stmt = db.prepare(
      "SELECT * FROM summaries WHERE session_id = ? AND prompt_type = ? ORDER BY created_at ASC",
    );
    return stmt.all(sessionId, promptType);
  }
  const stmt = db.prepare(
    "SELECT * FROM summaries WHERE session_id = ? ORDER BY created_at ASC",
  );
  return stmt.all(sessionId);
}

export function deleteSummary(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM summaries WHERE id = ?").run(id);
}

export function deleteSummariesBySession(
  db: Database.Database,
  sessionId: number,
): void {
  db.prepare("DELETE FROM summaries WHERE session_id = ?").run(sessionId);
}
