import type Database from "better-sqlite3";
import type { BrowserWindow } from "electron";

export interface IpcDeps {
  readonly db: Database.Database;
  readonly configDir: string;
  readonly getMainWindow: () => BrowserWindow | null;
}
