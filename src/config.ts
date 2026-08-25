/**
 * Configuration loading.
 *
 * Two options: `enabled` and `notify`. Read from global/project JSON files and
 * environment overrides, cached per working directory for the process lifetime
 * (`/reload` re-initializes extensions and picks up changes).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type JsonRecord = Record<string, unknown>;

export type ExtensionConfig = {
  enabled: boolean;
  notify: boolean;
};

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile(path: string): JsonRecord | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

const configByCwd = new Map<string, ExtensionConfig>();

export function loadConfig(cwd: string): ExtensionConfig {
  const cached = configByCwd.get(cwd);
  if (cached) return cached;

  const globalCfg = readJsonFile(join(homedir(), ".pi", "agent", "codex-compact.json")) ?? {};
  const projectCfg = readJsonFile(join(cwd, ".pi", "codex-compact.json")) ?? {};
  const merged = { ...globalCfg, ...projectCfg };

  const config: ExtensionConfig = {
    enabled:
      toBoolean(process.env.PI_CODEX_COMPACT_ENABLED) ??
      toBoolean(merged.enabled) ??
      true,
    notify:
      toBoolean(process.env.PI_CODEX_COMPACT_NOTIFY) ??
      toBoolean(merged.notify) ??
      true,
  };
  configByCwd.set(cwd, config);
  return config;
}
