import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export type Protocol = "openai" | "anthropic";

export interface AppConfig {
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  yolo: boolean;
  maxTurns: number;
}

export const DEFAULTS: Readonly<AppConfig> = Object.freeze({
  protocol: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  yolo: false,
  maxTurns: 24,
});

export const ANTHROPIC_DEFAULTS = Object.freeze({
  baseUrl: "https://api.anthropic.com",
  model: "claude-sonnet-4-5",
});

export interface ConfigSource {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
  globalConfigDir?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function globalConfigDir(): string {
  return path.join(os.homedir(), ".config", "opencode-arm");
}

export function configFilePaths(projectRoot?: string): {
  projectFile: string | null;
  globalFile: string;
} {
  return {
    projectFile: projectRoot ? path.join(projectRoot, ".opencode-arm.json") : null,
    globalFile: path.join(globalConfigDir(), "config.json"),
  };
}

export async function loadConfig(source: ConfigSource = {}): Promise<AppConfig> {
  const env = source.env ?? process.env;
  let config: AppConfig = { ...DEFAULTS };

  const globalDir = source.globalConfigDir ?? globalConfigDir();
  const projectFile = source.projectRoot
    ? path.join(source.projectRoot, ".opencode-arm.json")
    : null;
  const globalFile = path.join(globalDir, "config.json");

  const fromGlobal = await readConfigFile(globalFile);
  if (fromGlobal) config = merge(config, fromGlobal, globalFile);

  const fromProject = projectFile ? await readConfigFile(projectFile) : null;
  if (fromProject) config = merge(config, fromProject, projectFile!);

  config = applyEnv(config, env);
  validate(config);
  return config;
}

export async function saveGlobalConfig(
  config: Partial<AppConfig>,
  dir: string = globalConfigDir(),
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "config.json");
  const current = await readConfigFile(file);
  const merged = merge({ ...DEFAULTS }, { ...(current ?? {}), ...config }, file);
  validate(merged);
  await fs.writeFile(file, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

async function readConfigFile(file: string): Promise<Partial<AppConfig> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `${file} is not valid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${file} must contain a JSON object`);
  }
  const out: Record<string, unknown> = {};
  const obj = parsed as Record<string, unknown>;
  if ("protocol" in obj) out.protocol = obj.protocol;
  if ("baseUrl" in obj) out.baseUrl = obj.baseUrl;
  if ("apiKey" in obj) out.apiKey = obj.apiKey;
  if ("model" in obj) out.model = obj.model;
  if ("yolo" in obj) out.yolo = obj.yolo;
  if ("maxTurns" in obj) out.maxTurns = obj.maxTurns;
  return out as Partial<AppConfig>;
}

function merge(
  base: AppConfig,
  patch: Partial<AppConfig>,
  originForErrors: string,
): AppConfig {
  const next = { ...base };
  if (patch.protocol !== undefined) {
    if (patch.protocol !== "openai" && patch.protocol !== "anthropic") {
      throw new ConfigError(`${originForErrors}: protocol must be "openai" or "anthropic"`);
    }
    next.protocol = patch.protocol;
    // Switching protocol resets endpoint/model to that protocol's defaults,
    // unless baseUrl/model are also set in the same patch (applied below).
    if (next.protocol !== base.protocol) {
      next.baseUrl =
        patch.protocol === "anthropic"
          ? ANTHROPIC_DEFAULTS.baseUrl
          : DEFAULTS.baseUrl;
      next.model =
        patch.protocol === "anthropic"
          ? ANTHROPIC_DEFAULTS.model
          : DEFAULTS.model;
    }
  }
  if (patch.baseUrl !== undefined) {
    if (typeof patch.baseUrl !== "string" || !isHttpUrl(patch.baseUrl)) {
      throw new ConfigError(`${originForErrors}: baseUrl must be an http(s) URL`);
    }
    next.baseUrl = patch.baseUrl.replace(/\/+$/, "");
  }
  if (patch.apiKey !== undefined) next.apiKey = String(patch.apiKey);
  if (patch.model !== undefined) {
    if (typeof patch.model !== "string" || patch.model.trim().length === 0) {
      throw new ConfigError(`${originForErrors}: model must be a non-empty string`);
    }
    next.model = patch.model.trim();
  }
  if (patch.yolo !== undefined) next.yolo = patch.yolo === true;
  if (patch.maxTurns !== undefined) {
    const n = Number(patch.maxTurns);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      throw new ConfigError(`${originForErrors}: maxTurns must be between 1 and 100`);
    }
    next.maxTurns = Math.floor(n);
  }
  return next;
}

function applyEnv(config: AppConfig, env: NodeJS.ProcessEnv): AppConfig {
  const next = { ...config };
  const protocol = env["OPENCODE_ARM_PROTOCOL"];
  if (protocol === "openai" || protocol === "anthropic") {
    if (next.protocol !== protocol) {
      next.protocol = protocol;
      next.baseUrl =
        protocol === "anthropic"
          ? ANTHROPIC_DEFAULTS.baseUrl
          : DEFAULTS.baseUrl;
      next.model =
        protocol === "anthropic"
          ? ANTHROPIC_DEFAULTS.model
          : DEFAULTS.model;
    }
  }
  const baseUrl = env["OPENCODE_ARM_BASE_URL"];
  if (baseUrl && isHttpUrl(baseUrl)) next.baseUrl = baseUrl.replace(/\/+$/, "");
  const key =
    env["OPENCODE_ARM_API_KEY"] ??
    (next.protocol === "openai" ? env["OPENAI_API_KEY"] : env["ANTHROPIC_API_KEY"]);
  if (key) next.apiKey = key;
  const model = env["OPENCODE_ARM_MODEL"];
  if (model && model.trim().length > 0) next.model = model.trim();
  if (env["OPENCODE_ARM_YOLO"] === "1" || env["OPENCODE_ARM_YOLO"] === "true") {
    next.yolo = true;
  }
  const maxTurns = Number(env["OPENCODE_ARM_MAX_TURNS"]);
  if (Number.isFinite(maxTurns) && maxTurns >= 1 && maxTurns <= 100) {
    next.maxTurns = Math.floor(maxTurns);
  }
  return next;
}

function validate(config: AppConfig): void {
  if (config.protocol !== "openai" && config.protocol !== "anthropic") {
    throw new ConfigError('protocol must be "openai" or "anthropic"');
  }
  if (!isHttpUrl(config.baseUrl)) {
    throw new ConfigError(`baseUrl must be an http(s) URL, got ${config.baseUrl}`);
  }
  if (typeof config.model !== "string" || config.model.trim().length === 0) {
    throw new ConfigError("model must be a non-empty string");
  }
  if (!Number.isInteger(config.maxTurns) || config.maxTurns < 1 || config.maxTurns > 100) {
    throw new ConfigError("maxTurns must be an integer between 1 and 100");
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
