import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CONFIG_PATH,
  DEFAULT_ALLOWED_DOMAINS,
  buildSandboxConfig,
  loadUserConfig,
  mergeUserConfigs,
  resolveInnerCommand,
  shellQuote,
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
  test("引数なしならコマンドに引数を付与しない (opencode 側のデフォルト挙動に任せる)", () => {
    const cmd = resolveInnerCommand([], { distBinPath: "/nonexistent/securecode-bin" })
    expect(cmd).toContain("bun run --cwd packages/opencode --conditions=browser src/index.ts")
    // 引数 0 個 = pass-through する追加トークンも 0
    expect(cmd.trim().endsWith("src/index.ts")).toBe(true)
  })

  test("引数は加工せず opencode へ pass-through する (フラグも safe)", () => {
    const cmd = resolveInnerCommand(["--version"], { distBinPath: "/nonexistent/securecode-bin" })
    expect(cmd).toContain("'--version'")
    // 「--version」を target dir として resolve しないこと
    expect(cmd).not.toContain(`/--version'`)
  })

  test("配布バイナリ環境 (securecode-bin 存在) では opencode 単独バイナリを直接 spawn", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-bin-test-"))
    const innerBin = join(dir, "securecode-bin")
    writeFileSync(innerBin, "#!/bin/sh\necho ok\n", { mode: 0o755 })
    try {
      const cmd = resolveInnerCommand(["/tmp"], { distBinPath: innerBin })
      expect(cmd).toContain(shellQuote(innerBin))
      expect(cmd).toContain("'/tmp'")
      expect(cmd).not.toContain("bun run --cwd packages/opencode")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("開発ツリー環境 (securecode-bin 不在) では bun run --cwd packages/opencode にフォールバック", () => {
    const cmd = resolveInnerCommand(["/tmp"], { distBinPath: "/nonexistent/securecode-bin" })
    expect(cmd).toContain("bun run --cwd packages/opencode --conditions=browser src/index.ts")
    expect(cmd).toContain("'/tmp'")
  })

  test("shell の特殊文字 ($, バックティック, !) を含む arg を literal として渡す", () => {
    const cmd = resolveInnerCommand(["$HOME/repo", "`whoami`", "x!y"], {
      distBinPath: "/nonexistent/securecode-bin",
    })
    // single quote で囲まれているため、shell 展開・コマンド置換は起きない。
    expect(cmd).toContain("'$HOME/repo'")
    expect(cmd).toContain("'`whoami`'")
    expect(cmd).toContain("'x!y'")
  })

  test("arg 内の single quote を正しく escape する", () => {
    const cmd = resolveInnerCommand(["it's a path"], { distBinPath: "/nonexistent/securecode-bin" })
    // POSIX shell 標準の close-escape-reopen 形式 ('\'') で囲まれる。
    expect(cmd).toContain("'it'\\''s a path'")
  })
})

describe("mergeUserConfigs", () => {
  test("空入力なら全フィールド空配列", () => {
    const merged = mergeUserConfigs()
    expect(merged.network?.allowedDomains).toEqual([])
    expect(merged.network?.deniedDomains).toEqual([])
    expect(merged.filesystem?.allowRead).toEqual([])
    expect(merged.filesystem?.allowWrite).toEqual([])
    expect(merged.filesystem?.denyRead).toEqual([])
    expect(merged.filesystem?.denyWrite).toEqual([])
  })

  test("複数 config の allow / deny を concat する (入力順を維持)", () => {
    const a: UserConfig = {
      network: { allowedDomains: ["a.com"], deniedDomains: ["evil.com"] },
      filesystem: { denyRead: ["/asecret"] },
    }
    const b: UserConfig = {
      network: { allowedDomains: ["b.com"], deniedDomains: ["bad.org"] },
      filesystem: { denyRead: ["/bsecret"] },
    }
    const merged = mergeUserConfigs(a, b)
    expect(merged.network?.allowedDomains).toEqual(["a.com", "b.com"])
    expect(merged.network?.deniedDomains).toEqual(["evil.com", "bad.org"])
    expect(merged.filesystem?.denyRead).toEqual(["/asecret", "/bsecret"])
  })

  test("重複は除去しない (sandbox-runtime に重複は無害)", () => {
    const a: UserConfig = { network: { allowedDomains: ["dup.com"] } }
    const b: UserConfig = { network: { allowedDomains: ["dup.com"] } }
    expect(mergeUserConfigs(a, b).network?.allowedDomains).toEqual(["dup.com", "dup.com"])
  })

  test("片方だけ値があれば反映される (per-directory で許可を追加できる)", () => {
    const a: UserConfig = {}
    const b: UserConfig = { network: { allowedDomains: ["only.com"] } }
    expect(mergeUserConfigs(a, b).network?.allowedDomains).toEqual(["only.com"])
  })
})

describe("buildSandboxConfig with project config", () => {
  test("configPaths を渡すと全パスが denyRead / denyWrite の先頭に入る", () => {
    const globalPath = "/home/user/.config/securecode/sandbox.json"
    const projectPath = "/work/repo/.securecode/sandbox.json"
    const cfg = buildSandboxConfig(
      { filesystem: { denyRead: ["/extra"], denyWrite: ["/extra"] } },
      { configPaths: [globalPath, projectPath] },
    )
    expect(cfg.filesystem.denyRead).toEqual([globalPath, projectPath, "/extra"])
    expect(cfg.filesystem.denyWrite).toEqual([globalPath, projectPath, "/extra"])
  })

  test("configPaths 未指定なら従来通り CONFIG_PATH のみ deny に入る (後方互換)", () => {
    const cfg = buildSandboxConfig({})
    expect(cfg.filesystem.denyRead).toEqual([CONFIG_PATH])
    expect(cfg.filesystem.denyWrite).toEqual([CONFIG_PATH])
  })
})

describe("shellQuote", () => {
  test("通常文字列は single quote で囲むだけ", () => {
    expect(shellQuote("foo")).toBe("'foo'")
    expect(shellQuote("/tmp/dir")).toBe("'/tmp/dir'")
  })

  test("空文字は ''", () => {
    expect(shellQuote("")).toBe("''")
  })

  test("$ / バックティック / ! / 改行 / バックスラッシュ も literal 化", () => {
    // single quote で囲まれているので JSON.stringify と違い shell 展開されない。
    expect(shellQuote("$HOME")).toBe("'$HOME'")
    expect(shellQuote("`whoami`")).toBe("'`whoami`'")
    expect(shellQuote("a!b")).toBe("'a!b'")
    expect(shellQuote("a\nb")).toBe("'a\nb'")
    expect(shellQuote("a\\b")).toBe("'a\\b'")
  })

  test("single quote を含む場合は close-escape-reopen 形式", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
    expect(shellQuote("'leading")).toBe("''\\''leading'")
    expect(shellQuote("trailing'")).toBe("'trailing'\\'''")
  })
})
