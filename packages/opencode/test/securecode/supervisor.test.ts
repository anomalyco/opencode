import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CONFIG_PATH,
  DEFAULT_ALLOWED_DOMAINS,
  PROJECT_CONFIG_RELATIVE_PATH,
  buildSandboxConfig,
  loadMergedUserConfig,
  loadUserConfig,
  mergeUserConfigs,
  resolveInnerCommand,
  resolveProjectConfigPath,
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

describe("resolveProjectConfigPath", () => {
  test("cwd 直下の .securecode/sandbox.json を返す", () => {
    expect(resolveProjectConfigPath("/work/foo")).toBe(join("/work/foo", PROJECT_CONFIG_RELATIVE_PATH))
  })

  test("PROJECT_CONFIG_RELATIVE_PATH は `.securecode/sandbox.json`", () => {
    expect(PROJECT_CONFIG_RELATIVE_PATH).toBe(join(".securecode", "sandbox.json"))
  })
})

describe("mergeUserConfigs", () => {
  test("空入力なら空オブジェクトを返す", () => {
    expect(mergeUserConfigs()).toEqual({})
    expect(mergeUserConfigs({}, {})).toEqual({})
  })

  test("network.allowedDomains を union (重複除去) する", () => {
    const a: UserConfig = { network: { allowedDomains: ["a.com", "b.com"] } }
    const b: UserConfig = { network: { allowedDomains: ["b.com", "c.com"] } }
    expect(mergeUserConfigs(a, b).network?.allowedDomains).toEqual(["a.com", "b.com", "c.com"])
  })

  test("network.deniedDomains を union する", () => {
    const a: UserConfig = { network: { deniedDomains: ["evil.com"] } }
    const b: UserConfig = { network: { deniedDomains: ["evil.com", "bad.org"] } }
    expect(mergeUserConfigs(a, b).network?.deniedDomains).toEqual(["evil.com", "bad.org"])
  })

  test("filesystem.allow* / deny* を union する", () => {
    const a: UserConfig = {
      filesystem: { allowRead: ["/a"], allowWrite: ["/wa"], denyRead: ["/da"], denyWrite: ["/dwa"] },
    }
    const b: UserConfig = {
      filesystem: { allowRead: ["/b"], allowWrite: ["/wb"], denyRead: ["/db"], denyWrite: ["/dwb"] },
    }
    const merged = mergeUserConfigs(a, b)
    expect(merged.filesystem?.allowRead).toEqual(["/a", "/b"])
    expect(merged.filesystem?.allowWrite).toEqual(["/wa", "/wb"])
    expect(merged.filesystem?.denyRead).toEqual(["/da", "/db"])
    expect(merged.filesystem?.denyWrite).toEqual(["/dwa", "/dwb"])
  })

  test("片方だけ値があれば反映される", () => {
    const a: UserConfig = {}
    const b: UserConfig = { network: { allowedDomains: ["only.com"] } }
    expect(mergeUserConfigs(a, b).network?.allowedDomains).toEqual(["only.com"])
  })

  test("全フィールドが空 / undefined なら network / filesystem キー自体が生えない", () => {
    expect(mergeUserConfigs({ network: { allowedDomains: [] } }, {})).toEqual({})
  })

  test("global と project の両方で deny されたドメインは 1 度だけ残る (union)", () => {
    const global: UserConfig = { network: { deniedDomains: ["evil.com"] } }
    const project: UserConfig = { network: { deniedDomains: ["evil.com"] } }
    expect(mergeUserConfigs(global, project).network?.deniedDomains).toEqual(["evil.com"])
  })

  test("project 側だけで allow を増やせる (= per-directory で許可を拡張)", () => {
    const global: UserConfig = { network: { allowedDomains: ["common.com"] } }
    const project: UserConfig = { network: { allowedDomains: ["extra.com"] } }
    expect(mergeUserConfigs(global, project).network?.allowedDomains).toEqual(["common.com", "extra.com"])
  })
})

describe("loadMergedUserConfig", () => {
  test("両方不在なら空オブジェクト", () => {
    const cfg = loadMergedUserConfig({
      globalPath: "/nonexistent/global/sandbox.json",
      projectPath: "/nonexistent/project/sandbox.json",
    })
    expect(cfg).toEqual({})
  })

  test("global のみ存在", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-merged-"))
    const globalPath = join(dir, "global.json")
    writeFileSync(globalPath, JSON.stringify({ network: { allowedDomains: ["g.com"] } }))
    try {
      const cfg = loadMergedUserConfig({
        globalPath,
        projectPath: join(dir, "missing-project.json"),
      })
      expect(cfg.network?.allowedDomains).toEqual(["g.com"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("project のみ存在", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-merged-"))
    const projectPath = join(dir, "project.json")
    writeFileSync(projectPath, JSON.stringify({ network: { allowedDomains: ["p.com"] } }))
    try {
      const cfg = loadMergedUserConfig({
        globalPath: join(dir, "missing-global.json"),
        projectPath,
      })
      expect(cfg.network?.allowedDomains).toEqual(["p.com"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("両方存在: allow を union 、deny を union", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-merged-"))
    const globalPath = join(dir, "global.json")
    const projectPath = join(dir, "project.json")
    writeFileSync(
      globalPath,
      JSON.stringify({
        network: { allowedDomains: ["g.com"], deniedDomains: ["evil.com"] },
        filesystem: { denyRead: ["/gsecret"] },
      }),
    )
    writeFileSync(
      projectPath,
      JSON.stringify({
        network: { allowedDomains: ["p.com"], deniedDomains: ["bad.org"] },
        filesystem: { denyRead: ["/psecret"] },
      }),
    )
    try {
      const cfg = loadMergedUserConfig({ globalPath, projectPath })
      expect(cfg.network?.allowedDomains).toEqual(["g.com", "p.com"])
      expect(cfg.network?.deniedDomains).toEqual(["evil.com", "bad.org"])
      expect(cfg.filesystem?.denyRead).toEqual(["/gsecret", "/psecret"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("project sandbox.json のデフォルト位置 (cwd/.securecode/sandbox.json) を解決できる", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-cwd-"))
    mkdirSync(join(dir, ".securecode"), { recursive: true })
    writeFileSync(
      join(dir, PROJECT_CONFIG_RELATIVE_PATH),
      JSON.stringify({ network: { allowedDomains: ["from-cwd.com"] } }),
    )
    try {
      const cfg = loadMergedUserConfig({
        globalPath: join(dir, "no-such-global.json"),
        projectPath: resolveProjectConfigPath(dir),
      })
      expect(cfg.network?.allowedDomains).toEqual(["from-cwd.com"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
    expect(cfg.filesystem.denyRead?.slice(0, 2)).toEqual([globalPath, projectPath])
    expect(cfg.filesystem.denyRead).toEqual([globalPath, projectPath, "/extra"])
    expect(cfg.filesystem.denyWrite?.slice(0, 2)).toEqual([globalPath, projectPath])
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
