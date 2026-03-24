import fs from "fs";
import path from "path";

export interface AppConfig {
  readonly dataDir: string | null;
  readonly selectedAudioDeviceId: string | null;
  readonly modelRegistryUrl: string | null;
  readonly hfMirrorUrl: string | null;
}

const CONFIG_FILENAME = "config.json";

const DEFAULT_CONFIG: AppConfig = {
  dataDir: null,
  selectedAudioDeviceId: null,
  modelRegistryUrl: null,
  hfMirrorUrl: null,
};

export function readConfig(configDir: string): AppConfig {
  const configPath = path.join(configDir, CONFIG_FILENAME);

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(configDir: string, config: AppConfig): void {
  fs.mkdirSync(configDir, { recursive: true });

  const configPath = path.join(configDir, CONFIG_FILENAME);
  const content = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, content, "utf-8");
}

export function getDataDir(configDir: string): string | null {
  const config = readConfig(configDir);
  return config.dataDir;
}
