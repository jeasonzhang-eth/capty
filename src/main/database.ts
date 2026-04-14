import Database from "better-sqlite3";

export interface CreateSessionOpts {
  readonly modelName: string;
  readonly category?: string;
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
  readonly playbackPosition?: number;
  readonly category?: string;
  readonly sortOrder?: number;
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

  // Migrate: add playback_position column for remembering playback progress
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN playback_position REAL DEFAULT 0");
  } catch {
    // Column already exists — ignore
  }

  // Migrate: add category column for session type grouping
  try {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN category TEXT NOT NULL DEFAULT 'recording'",
    );
  } catch {
    // Column already exists — ignore
  }

  // Migrate: add sort_order column for manual session ordering
  try {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    );
  } catch {
    // Column already exists — ignore
  }

  // Migrate: auto-categorize existing download sessions
  db.exec(`
    UPDATE sessions SET category = 'download'
    WHERE model_name IN ('yt-dlp', 'xiaoyuzhou', 'imported') AND category = 'recording'
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS segment_translations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      target_language TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (segment_id) REFERENCES segments(id),
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      UNIQUE(segment_id, target_language)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      url           TEXT NOT NULL,
      title         TEXT,
      source        TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      progress      REAL DEFAULT 0,
      speed         TEXT,
      eta           TEXT,
      temp_dir      TEXT,
      session_id    INTEGER,
      error         TEXT,
      created_at    TEXT NOT NULL,
      completed_at  TEXT
    )
  `);
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
  const category = opts.category ?? "recording";
  const stmt = db.prepare(
    "INSERT INTO sessions (model_name, started_at, title, category) VALUES (?, ?, ?, ?)",
  );
  const result = stmt.run(opts.modelName, localTime, localTime, category);
  return result.lastInsertRowid as number;
}

export interface SessionRow {
  readonly id: number;
  readonly title: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly duration_seconds: number | null;
  readonly audio_path: string | null;
  readonly model_name: string;
  readonly status: string;
  readonly playback_position: number | null;
  readonly category: string;
  readonly sort_order: number;
}

export interface SegmentRow {
  readonly id: number;
  readonly session_id: number;
  readonly segment_index: number;
  readonly start_time: number;
  readonly end_time: number;
  readonly text: string;
}

export interface SummaryRow {
  readonly id: number;
  readonly session_id: number;
  readonly provider: string;
  readonly model: string;
  readonly content: string;
  readonly created_at: string;
}

export function getSession(
  db: Database.Database,
  id: number,
): SessionRow | undefined {
  const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  return stmt.get(id) as SessionRow | undefined;
}

export function listSessions(db: Database.Database): SessionRow[] {
  const stmt = db.prepare(
    "SELECT * FROM sessions ORDER BY sort_order DESC, started_at DESC",
  );
  return stmt.all() as SessionRow[];
}

export function reorderSessions(
  db: Database.Database,
  sessionIds: readonly number[],
): void {
  const update = db.prepare("UPDATE sessions SET sort_order = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (let i = 0; i < sessionIds.length; i++) {
      update.run(sessionIds.length - i, sessionIds[i]);
    }
  });
  tx();
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

export function getSegments(
  db: Database.Database,
  sessionId: number,
): SegmentRow[] {
  const stmt = db.prepare(
    "SELECT * FROM segments WHERE session_id = ? ORDER BY start_time ASC",
  );
  return stmt.all(sessionId) as SegmentRow[];
}

export function deleteSegmentsBySession(
  db: Database.Database,
  sessionId: number,
): void {
  db.prepare("DELETE FROM segments WHERE session_id = ?").run(sessionId);
}

export function deleteSession(db: Database.Database, id: number): void {
  const del = db.transaction(() => {
    // Delete translations by segment_id subquery (covers mismatched session_id)
    db.prepare(
      "DELETE FROM segment_translations WHERE segment_id IN (SELECT id FROM segments WHERE session_id = ?)",
    ).run(id);
    deleteTranslationsBySession(db, id);
    deleteSummariesBySession(db, id);
    deleteSegmentsBySession(db, id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  });
  del();
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
  if (fields.playbackPosition !== undefined) {
    setClauses.push("playback_position = ?");
    values.push(fields.playbackPosition);
  }
  if (fields.category !== undefined) {
    setClauses.push("category = ?");
    values.push(fields.category);
  }
  if (fields.sortOrder !== undefined) {
    setClauses.push("sort_order = ?");
    values.push(fields.sortOrder);
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
): SummaryRow[] {
  if (promptType) {
    const stmt = db.prepare(
      "SELECT * FROM summaries WHERE session_id = ? AND prompt_type = ? ORDER BY created_at ASC",
    );
    return stmt.all(sessionId, promptType) as SummaryRow[];
  }
  const stmt = db.prepare(
    "SELECT * FROM summaries WHERE session_id = ? ORDER BY created_at ASC",
  );
  return stmt.all(sessionId) as SummaryRow[];
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

// ─── Segment Translations ───

export interface TranslationRow {
  readonly id: number;
  readonly segment_id: number;
  readonly session_id: number;
  readonly target_language: string;
  readonly translated_text: string;
  readonly created_at: string;
}

export function saveTranslation(
  db: Database.Database,
  opts: {
    segmentId: number;
    sessionId: number;
    targetLanguage: string;
    translatedText: string;
  },
): number {
  const stmt = db.prepare(
    `INSERT INTO segment_translations (segment_id, session_id, target_language, translated_text)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(segment_id, target_language) DO UPDATE SET translated_text = excluded.translated_text`,
  );
  const result = stmt.run(
    opts.segmentId,
    opts.sessionId,
    opts.targetLanguage,
    opts.translatedText,
  );
  return result.lastInsertRowid as number;
}

export function getTranslations(
  db: Database.Database,
  sessionId: number,
  targetLanguage: string,
): TranslationRow[] {
  const stmt = db.prepare(
    "SELECT * FROM segment_translations WHERE session_id = ? AND target_language = ? ORDER BY segment_id ASC",
  );
  return stmt.all(sessionId, targetLanguage) as TranslationRow[];
}

export function deleteTranslationsBySession(
  db: Database.Database,
  sessionId: number,
): void {
  db.prepare("DELETE FROM segment_translations WHERE session_id = ?").run(
    sessionId,
  );
}

// ─── Downloads ───

export interface DownloadRow {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly source: string | null;
  readonly status: string;
  readonly progress: number;
  readonly speed: string | null;
  readonly eta: string | null;
  readonly temp_dir: string | null;
  readonly session_id: number | null;
  readonly error: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
}

export function createDownload(
  db: Database.Database,
  opts: { url: string; source: string },
): number {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const localTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const stmt = db.prepare(
    "INSERT INTO downloads (url, source, status, created_at) VALUES (?, ?, 'pending', ?)",
  );
  const result = stmt.run(opts.url, opts.source, localTime);
  return result.lastInsertRowid as number;
}

export function getDownload(
  db: Database.Database,
  id: number,
): DownloadRow | undefined {
  return db.prepare("SELECT * FROM downloads WHERE id = ?").get(id) as
    | DownloadRow
    | undefined;
}

export function listDownloads(db: Database.Database): DownloadRow[] {
  return db
    .prepare("SELECT * FROM downloads ORDER BY created_at DESC")
    .all() as DownloadRow[];
}

export function updateDownload(
  db: Database.Database,
  id: number,
  fields: Partial<{
    title: string;
    status: string;
    progress: number;
    speed: string;
    eta: string;
    temp_dir: string;
    session_id: number;
    error: string | null;
    completed_at: string;
  }>,
): void {
  const ALLOWED_COLUMNS = new Set([
    "title",
    "status",
    "progress",
    "speed",
    "eta",
    "temp_dir",
    "session_id",
    "error",
    "completed_at",
  ]);
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_COLUMNS.has(key)) {
      throw new Error(`Invalid column name: ${key}`);
    }
    setClauses.push(`${key} = ?`);
    values.push(value);
  }
  if (setClauses.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE downloads SET ${setClauses.join(", ")} WHERE id = ?`).run(
    ...values,
  );
}

export function deleteDownload(db: Database.Database, id: number): void {
  db.prepare("DELETE FROM downloads WHERE id = ?").run(id);
}

export function listInterruptedDownloads(db: Database.Database): DownloadRow[] {
  return db
    .prepare(
      "SELECT * FROM downloads WHERE status IN ('pending', 'downloading', 'converting') ORDER BY created_at DESC",
    )
    .all() as DownloadRow[];
}
