import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CONFIG_PATH,
  DEFAULT_ALLOWED_DOMAINS,
  buildSandboxConfig,
  loadUserConfig,
  resolveInnerCommand,
  type UserConfig,
} from "../../../../script/securecode-supervisor"

describe("buildSandboxConfig", () => {
  test("デフォルト allowlist に CIA endpoint だけ入る", () => {
    const cfg = buildSandboxConfig({})
    expect(cfg.network.allowedDomains).toEqual(DEFAULT_ALLOWED_DOMAINS)
  })

  test("user の allowedDomains は default の後ろに追加される (上書きではない)", () => {
    const user: UserConfig = { network: { allowedDomains: ["example.com", "foo.org"] } }
    const cfg = buildSandboxConfig(user)
    expect(cfg.network.allowedDomains).toEqual([...DEFAULT_ALLOWED_DOMAINS, "example.com", "foo.org"])
  })

  test("denyRead の先頭に CONFIG_PATH が必ず入る", () => {
    const cfg = buildSandboxConfig({})
    expect(cfg.filesystem.denyRead?.[0]).toBe(CONFIG_PATH)
  })

  test("user の denyRead は CONFIG_PATH の後ろに追加される", () => {
    const user: UserConfig = { filesystem: { denyRead: ["/secret"] } }
    const cfg = buildSandboxConfig(user)
    expect(cfg.filesystem.denyRead).toEqual([CONFIG_PATH, "/secret"])
  })

  test("denyWrite の先頭に CONFIG_PATH が必ず入る", () => {
    const cfg = buildSandboxConfig({})
    expect(cfg.filesystem.denyWrite?.[0]).toBe(CONFIG_PATH)
  })

  test("user の denyWrite は CONFIG_PATH の後ろに追加される", () => {
    const user: UserConfig = { filesystem: { denyWrite: ["/foo"] } }
    const cfg = buildSandboxConfig(user)
    expect(cfg.filesystem.denyWrite).toEqual([CONFIG_PATH, "/foo"])
  })

  test("allowWrite 未指定なら ['/'] フォールバック", () => {
    const cfg = buildSandboxConfig({})
    expect(cfg.filesystem.allowWrite).toEqual(["/"])
  })

  test("allowWrite 指定があればそれを使う", () => {
    const user: UserConfig = { filesystem: { allowWrite: ["/workspace"] } }
    const cfg = buildSandboxConfig(user)
    expect(cfg.filesystem.allowWrite).toEqual(["/workspace"])
  })

  test("allowPty が true", () => {
    expect(buildSandboxConfig({}).allowPty).toBe(true)
  })

  test("network.allowLocalBinding が true", () => {
    expect(buildSandboxConfig({}).network.allowLocalBinding).toBe(true)
  })

  test("deniedDomains は user 指定値、未指定なら空配列", () => {
    expect(buildSandboxConfig({}).network.deniedDomains).toEqual([])
    expect(buildSandboxConfig({ network: { deniedDomains: ["evil.com"] } }).network.deniedDomains).toEqual([
      "evil.com",
    ])
  })
})

describe("loadUserConfig", () => {
  test("config 不在時は空オブジェクトを返す", () => {
    const cfg = loadUserConfig("/nonexistent/securecode-sandbox-phase0/sandbox.json")
    expect(cfg).toEqual({})
  })

  test("正常な JSON を parse して返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-test-"))
    const tmpPath = join(dir, "sandbox.json")
    writeFileSync(tmpPath, JSON.stringify({ network: { allowedDomains: ["foo.com"] } }))
    try {
      const cfg = loadUserConfig(tmpPath)
      expect(cfg.network?.allowedDomains).toEqual(["foo.com"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("resolveInnerCommand", () => {
  test("引数なしなら process.cwd() を使う", () => {
    const cmd = resolveInnerCommand([])
    expect(cmd).toContain(JSON.stringify(process.cwd()))
  })

  test("引数を絶対パスに正規化", () => {
    const cmd = resolveInnerCommand(["/tmp"])
    expect(cmd).toContain('"/tmp"')
  })

  test("opencode 起動コマンドを内包", () => {
    const cmd = resolveInnerCommand([])
    expect(cmd).toContain("bun run --cwd packages/opencode --conditions=browser src/index.ts")
  })
})
