import { spawn as rawSpawn, type SpawnOptions, type ChildProcess } from "child_process";

const EXTRA_PATHS = [
  "/opt/homebrew/bin", // Apple Silicon Homebrew
  "/opt/homebrew/sbin",
  "/usr/local/bin", // Intel Homebrew / manual installs
  "/usr/local/sbin",
];

export function getExtendedEnv(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH ?? "";
  const missing = EXTRA_PATHS.filter((p) => !currentPath.includes(p));
  if (missing.length === 0) return process.env;
  return { ...process.env, PATH: `${missing.join(":")}:${currentPath}` };
}

/** Spawn with extended PATH so packaged apps find Homebrew binaries. */
export function spawn(
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
): ChildProcess {
  return rawSpawn(command, args, { ...options, env: getExtendedEnv() });
}
