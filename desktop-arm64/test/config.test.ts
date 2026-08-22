import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  loadConfig,
  saveGlobalConfig,
  ConfigError,
  DEFAULTS,
  ANTHROPIC_DEFAULTS,
} from "../src/core/config.ts";

test("defaults when nothing configured", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ocarm-def-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = await loadConfig({
    env: {},
    projectRoot: undefined,
    globalConfigDir: dir,
  });
  assert.deepEqual(config, { ...DEFAULTS, apiKey: "" });
});

test("env vars override with protocol-aware key fallback", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ocarm-env-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = await loadConfig({
    env: {
      OPENCODE_ARM_PROTOCOL: "anthropic",
      ANTHROPIC_API_KEY: "sk-ant",
      OPENCODE_ARM_MODEL: "claude-test",
    },
    globalConfigDir: dir,
  });
  assert.equal(config.protocol, "anthropic");
  assert.equal(config.baseUrl, ANTHROPIC_DEFAULTS.baseUrl);
  assert.equal(config.model, "claude-test");
  assert.equal(config.apiKey, "sk-ant");
});

test("openai protocol falls back to OPENAI_API_KEY", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ocarm-oai-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = await loadConfig({
    env: { OPENAI_API_KEY: "sk-oai" },
    globalConfigDir: dir,
  });
  assert.equal(config.protocol, "openai");
  assert.equal(config.apiKey, "sk-oai");
});

test("project file beats global file; both beat defaults", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocarm-cfg-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const globalDir = path.join(root, "global");
  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(
    path.join(globalDir, "config.json"),
    JSON.stringify({ model: "from-global", maxTurns: 10 }),
  );
  const projectDir = path.join(root, "project");
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, ".opencode-arm.json"),
    JSON.stringify({ model: "from-project" }),
  );

  const config = await loadConfig({
    env: {},
    globalConfigDir: globalDir,
    projectRoot: projectDir,
  });
  assert.equal(config.model, "from-project");
  assert.equal(config.maxTurns, 10);
});

test("protocol switch resets endpoint and model to matching defaults", async (t) => {
  const dir0 = await fs.mkdtemp(path.join(os.tmpdir(), "ocarm-swap0-"));
  t.after(() => fs.rm(dir0, { recursive: true, force: true }));

  // switching to anthropic -> anthropic endpoint/model
  const switched = await loadConfig({
    env: { OPENCODE_ARM_PROTOCOL: "anthropic" },
    globalConfigDir: dir0,
  });
  assert.equal(switched.baseUrl, ANTHROPIC_DEFAULTS.baseUrl);
  assert.equal(switched.model, ANTHROPIC_DEFAULTS.model);

  // switching back explicitly via file patch
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ocarm-swap-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(dir, ".opencode-arm.json"),
    JSON.stringify({ protocol: "openai" }),
  );
  const back = await loadConfig({ env: {}, projectRoot: dir, globalConfigDir: dir0 });
  assert.equal(back.protocol, "openai");
  assert.equal(back.baseUrl, DEFAULTS.baseUrl);
  assert.equal(back.model, DEFAULTS.model);
});

test("invalid values raise ConfigError", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocarm-bad-"));
  const iso = await fs.mkdtemp(path.join(os.tmpdir(), "ocarm-bad-g-"));
  t.after(() => {
    fs.rm(root, { recursive: true, force: true });
    fs.rm(iso, { recursive: true, force: true });
  });
  const bad = path.join(root, ".opencode-arm.json");

  await fs.writeFile(bad, JSON.stringify({ protocol: "gemini" }));
  await assert.rejects(
    () => loadConfig({ env: {}, projectRoot: root, globalConfigDir: iso }),
    ConfigError,
  );

  await fs.writeFile(bad, JSON.stringify({ baseUrl: "ftp://x" }));
  await assert.rejects(
    () => loadConfig({ env: {}, projectRoot: root, globalConfigDir: iso }),
    ConfigError,
  );

  await fs.writeFile(bad, JSON.stringify({ maxTurns: 0 }));
  await assert.rejects(
    () => loadConfig({ env: {}, projectRoot: root, globalConfigDir: iso }),
    ConfigError,
  );

  await fs.writeFile(bad, "{broken json");
  await assert.rejects(
    () => loadConfig({ env: {}, projectRoot: root, globalConfigDir: iso }),
    ConfigError,
  );
});

test("saveGlobalConfig merges and persists", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ocarm-save-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await saveGlobalConfig({ model: "m1" }, dir);
  await saveGlobalConfig({ yolo: true }, dir);
  const raw = JSON.parse(
    await fs.readFile(path.join(dir, "config.json"), "utf8"),
  );
  assert.equal(raw.model, "m1");
  assert.equal(raw.yolo, true);
});
