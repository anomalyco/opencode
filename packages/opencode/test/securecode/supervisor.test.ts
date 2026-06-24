import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  CONFIG_PATH,
  DEFAULT_ALLOWED_DOMAINS,
  buildRespawnArgs,
  buildSandboxConfig,
  cleanupStaleRuntimeDirs,
  computeSandboxConfigHash,
  defaultAllowWrite,
  loadUserConfig,
  mergeUserConfigs,
  prepareRuntimeDir,
  resetTerminal,
  resolveInnerCommand,
  resolveReload,
  setupSessionTmpdir,
  shellQuote,
  startSandboxConfigWatcher,
  tryLoadUserConfig,
  writeHashFile,
  type UserConfig,
} from "../../../../script/securecode-supervisor"

// 部分指定の object から正規化済み `UserConfig` を作るテスト fixture helper。
// 本番フローでは loadUserConfig が同等の normalize を行うが、ファイル経由を毎テストで
// 行うのは重いので、ここで inline で `[]` 埋めしている (= loadUserConfig 内のロジックの
// テスト用ミラー)。
type PartialConfig = {
  network?: { allowedDomains?: string[]; deniedDomains?: string[] }
  filesystem?: { allowRead?: string[]; allowWrite?: string[]; denyRead?: string[]; denyWrite?: string[] }
}
function makeConfig(partial: PartialConfig = {}): UserConfig {
  return {
    network: {
      allowedDomains: partial.network?.allowedDomains ?? [],
      deniedDomains: partial.network?.deniedDomains ?? [],
    },
    filesystem: {
      allowRead: partial.filesystem?.allowRead ?? [],
      allowWrite: partial.filesystem?.allowWrite ?? [],
      denyRead: partial.filesystem?.denyRead ?? [],
      denyWrite: partial.filesystem?.denyWrite ?? [],
    },
  }
}
const cfgFor = (
  partial: PartialConfig = {},
  opts: { configPaths?: string[]; cwd?: string; tmp?: string } = {},
) => buildSandboxConfig(makeConfig(partial), opts)

describe("buildSandboxConfig", () => {
  test("デフォルト allowlist に CIA endpoint だけ入る", () => {
    expect(cfgFor().network.allowedDomains).toEqual(DEFAULT_ALLOWED_DOMAINS)
  })

  test("user の allowedDomains は default の後ろに追加される (上書きではない)", () => {
    const cfg = cfgFor({ network: { allowedDomains: ["example.com", "foo.org"] } })
    expect(cfg.network.allowedDomains).toEqual([...DEFAULT_ALLOWED_DOMAINS, "example.com", "foo.org"])
  })

  test("denyRead の先頭に CONFIG_PATH が必ず入る", () => {
    expect(cfgFor().filesystem.denyRead?.[0]).toBe(CONFIG_PATH)
  })

  test("user の denyRead は CONFIG_PATH の後ろに追加される", () => {
    expect(cfgFor({ filesystem: { denyRead: ["/secret"] } }).filesystem.denyRead).toEqual([CONFIG_PATH, "/secret"])
  })

  test("denyWrite の先頭に CONFIG_PATH が必ず入る", () => {
    expect(cfgFor().filesystem.denyWrite?.[0]).toBe(CONFIG_PATH)
  })

  test("user の denyWrite は CONFIG_PATH の後ろに追加される", () => {
    expect(cfgFor({ filesystem: { denyWrite: ["/foo"] } }).filesystem.denyWrite).toEqual([CONFIG_PATH, "/foo"])
  })

  test("allowWrite 未指定でもベースライン (cwd + XDG 配下 + tmp) が入る", () => {
    // 「ユーザが allowWrite を書かなくても cwd と securecode 内部パスは書ける」
    // ことを保証する。詳細は defaultAllowWrite の describe ブロック参照。
    const allowWrite = cfgFor({}, { cwd: "/work/repo", tmp: "/var/tmp/securecode-1" }).filesystem.allowWrite
    expect(allowWrite).toEqual(defaultAllowWrite({ cwd: "/work/repo", tmp: "/var/tmp/securecode-1" }))
    expect(allowWrite).toContain("/work/repo")
    expect(allowWrite).toContain("/var/tmp/securecode-1")
  })

  test("allowWrite 指定はベースラインの後ろに追加される (加算式)", () => {
    // 加算式 = ユーザが allowWrite を書いても cwd / XDG パスが消えない。
    // これが上書き式フォールバックからの一番大きな挙動変更。
    const allowWrite = cfgFor(
      { filesystem: { allowWrite: ["/workspace", "../sibling"] } },
      { cwd: "/work/repo", tmp: "/var/tmp/securecode-1" },
    ).filesystem.allowWrite
    expect(allowWrite).toEqual([
      ...defaultAllowWrite({ cwd: "/work/repo", tmp: "/var/tmp/securecode-1" }),
      "/workspace",
      "../sibling",
    ])
  })

  test("allowWrite ベースラインで cwd が先頭に入る", () => {
    // sandbox-runtime に渡す順序自体は安全性に影響しないが、デバッグ時の
    // ログを見やすくする / regression を捕まえやすくする意図で順序を固定。
    expect(cfgFor({}, { cwd: "/work/repo" }).filesystem.allowWrite[0]).toBe("/work/repo")
  })

  test("tmp opts が渡されればベースラインの tmp スロットに反映される", () => {
    // per-session TMPDIR を baseline に組み込む経路を保証する。main() からは
    // setupSessionTmpdir() の戻り値が渡されることを想定。
    const allowWrite = cfgFor({}, { cwd: "/work/repo", tmp: "/var/tmp/securecode-9999" }).filesystem.allowWrite
    expect(allowWrite).toContain("/var/tmp/securecode-9999")
  })

  test("allowPty が true", () => {
    expect(cfgFor().allowPty).toBe(true)
  })

  test("network.allowLocalBinding が true", () => {
    expect(cfgFor().network.allowLocalBinding).toBe(true)
  })

  test("deniedDomains は user 指定値、未指定なら空配列", () => {
    expect(cfgFor().network.deniedDomains).toEqual([])
    expect(cfgFor({ network: { deniedDomains: ["evil.com"] } }).network.deniedDomains).toEqual(["evil.com"])
  })
})

describe("loadUserConfig", () => {
  test("config 不在時は全フィールド空配列の正規化済み config を返す", () => {
    const cfg = loadUserConfig("/nonexistent/securecode-sandbox-phase0/sandbox.json")
    expect(cfg.network.allowedDomains).toEqual([])
    expect(cfg.filesystem.denyRead).toEqual([])
  })

  test("正常な JSON を parse して正規化済み config を返す (欠落キーは [] 埋め)", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-test-"))
    const tmpPath = join(dir, "sandbox.json")
    writeFileSync(tmpPath, JSON.stringify({ network: { allowedDomains: ["foo.com"] } }))
    try {
      const cfg = loadUserConfig(tmpPath)
      expect(cfg.network.allowedDomains).toEqual(["foo.com"])
      expect(cfg.network.deniedDomains).toEqual([])
      expect(cfg.filesystem.denyRead).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("JSON parse 失敗時は throw する (process.exit を直接呼ばない)", () => {
    // die() は外側の `try/finally` で session.cleanup を確実に走らせる必要があるため、
    // process.exit 直接呼びではなく throw する設計。loadUserConfig 経路でその挙動が
    // 退化していないことをガードする。
    const dir = mkdtempSync(join(tmpdir(), "securecode-test-"))
    const tmpPath = join(dir, "sandbox.json")
    writeFileSync(tmpPath, "{ this is not valid json")
    try {
      expect(() => loadUserConfig(tmpPath)).toThrow(/failed to read\/parse/)
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
    expect(merged.network.allowedDomains).toEqual([])
    expect(merged.network.deniedDomains).toEqual([])
    expect(merged.filesystem.allowRead).toEqual([])
    expect(merged.filesystem.allowWrite).toEqual([])
    expect(merged.filesystem.denyRead).toEqual([])
    expect(merged.filesystem.denyWrite).toEqual([])
  })

  test("複数 config の allow / deny を concat する (入力順を維持)", () => {
    const a = makeConfig({
      network: { allowedDomains: ["a.com"], deniedDomains: ["evil.com"] },
      filesystem: { denyRead: ["/asecret"] },
    })
    const b = makeConfig({
      network: { allowedDomains: ["b.com"], deniedDomains: ["bad.org"] },
      filesystem: { denyRead: ["/bsecret"] },
    })
    const merged = mergeUserConfigs(a, b)
    expect(merged.network.allowedDomains).toEqual(["a.com", "b.com"])
    expect(merged.network.deniedDomains).toEqual(["evil.com", "bad.org"])
    expect(merged.filesystem.denyRead).toEqual(["/asecret", "/bsecret"])
  })

  test("重複は除去しない (sandbox-runtime に重複は無害)", () => {
    const a = makeConfig({ network: { allowedDomains: ["dup.com"] } })
    const b = makeConfig({ network: { allowedDomains: ["dup.com"] } })
    expect(mergeUserConfigs(a, b).network.allowedDomains).toEqual(["dup.com", "dup.com"])
  })

  test("片方だけ値があれば反映される (per-directory で許可を追加できる)", () => {
    const a = makeConfig({})
    const b = makeConfig({ network: { allowedDomains: ["only.com"] } })
    expect(mergeUserConfigs(a, b).network.allowedDomains).toEqual(["only.com"])
  })
})

describe("buildSandboxConfig with project config", () => {
  test("configPaths を渡すと全パスが denyRead / denyWrite の先頭に入る", () => {
    const globalPath = "/home/user/.config/securecode/sandbox.json"
    const projectPath = "/work/repo/.securecode/sandbox.json"
    const cfg = buildSandboxConfig(makeConfig({ filesystem: { denyRead: ["/extra"], denyWrite: ["/extra"] } }), {
      configPaths: [globalPath, projectPath],
    })
    expect(cfg.filesystem.denyRead).toEqual([globalPath, projectPath, "/extra"])
    expect(cfg.filesystem.denyWrite).toEqual([globalPath, projectPath, "/extra"])
  })

  test("configPaths 未指定なら CONFIG_PATH のみが deny に入る", () => {
    const cfg = buildSandboxConfig(makeConfig())
    expect(cfg.filesystem.denyRead).toEqual([CONFIG_PATH])
    expect(cfg.filesystem.denyWrite).toEqual([CONFIG_PATH])
  })
})

describe("defaultAllowWrite", () => {
  // XDG 環境変数を狙って差し替えるため、各テストで保存→復元する。
  const XDG_VARS = ["XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME"] as const
  let saved: Partial<Record<(typeof XDG_VARS)[number], string | undefined>>
  beforeEach(() => {
    saved = {}
    for (const k of XDG_VARS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of XDG_VARS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  test("XDG 未設定なら spec 標準のフォールバックを使う", () => {
    const home = homedir()
    const paths = defaultAllowWrite({ cwd: "/work/repo", tmp: "/sess/tmp" })
    expect(paths).toEqual([
      "/work/repo",
      join(home, ".local", "share", "securecode"),
      join(home, ".cache", "securecode"),
      join(home, ".config", "securecode"),
      join(home, ".local", "state", "securecode"),
      "/sess/tmp",
    ])
  })

  test("XDG_* が絶対パスならそちらを採用する", () => {
    process.env.XDG_DATA_HOME = "/custom/data"
    process.env.XDG_CACHE_HOME = "/custom/cache"
    process.env.XDG_CONFIG_HOME = "/custom/config"
    process.env.XDG_STATE_HOME = "/custom/state"
    const paths = defaultAllowWrite({ cwd: "/work/repo" })
    expect(paths).toContain("/custom/data/securecode")
    expect(paths).toContain("/custom/cache/securecode")
    expect(paths).toContain("/custom/config/securecode")
    expect(paths).toContain("/custom/state/securecode")
  })

  test("XDG_* が相対パスなら process.cwd() 基準で絶対化して採用する", () => {
    // inner (xdg-basedir) は truthy 値をそのまま `path.join(v, "securecode")` で
    // 解決する = relative なら process.cwd() 基準。supervisor も同じ起点で
    // 絶対化することで、sandbox baseline と inner の書き込み先が drift しないことを
    // 保証する (= 絶対化せず無視すると、inner だけ relative path 配下に書こうとして
    // sandbox に弾かれる)。
    process.env.XDG_DATA_HOME = "relative/path"
    const paths = defaultAllowWrite({ cwd: "/work/repo" })
    expect(paths).toContain(join(resolve("relative/path"), "securecode"))
  })

  test("XDG_* が空文字なら spec 標準のフォールバックを使う", () => {
    // inner (xdg-basedir) は `env || fallback` なので空文字は fallback 採用。
    // supervisor も同じ挙動になっていることを保証。
    process.env.XDG_DATA_HOME = ""
    const home = homedir()
    expect(defaultAllowWrite({ cwd: "/work/repo" })).toContain(join(home, ".local", "share", "securecode"))
  })

  test("cwd は常に先頭に入る", () => {
    expect(defaultAllowWrite({ cwd: "/work/repo" })[0]).toBe("/work/repo")
  })

  test("tmp 未指定なら $TMPDIR/securecode にフォールバック", () => {
    // 本番経路では main() が setupSessionTmpdir() の path を渡すが、テストや
    // 直接呼び出しでは未指定もあり得る。Global.Path.tmp と整合する値が入ること。
    expect(defaultAllowWrite({ cwd: "/work/repo" })).toContain(join(tmpdir(), "securecode"))
  })
})

describe("setupSessionTmpdir", () => {
  test("base/suffix を指定すると base/securecode-<suffix>/ を作成する", () => {
    // base 自身は mkdtemp で実在ディレクトリだが、`os.tmpdir()` が `/var/folders/...`
    // 等の symlink を含むパスを返すプラットフォームでは setupSessionTmpdir が
    // realpath に展開するため、期待値も realpath で組み立てる。
    const base = realpathSync(mkdtempSync(join(tmpdir(), "sess-test-")))
    try {
      const sess = setupSessionTmpdir({ base, suffix: "12345-deadbeef" })
      try {
        expect(sess.path).toBe(join(base, "securecode-12345-deadbeef"))
        expect(existsSync(sess.path)).toBe(true)
      } finally {
        sess.cleanup()
      }
      // cleanup 後はディレクトリが消えること
      expect(existsSync(join(base, "securecode-12345-deadbeef"))).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("suffix 未指定なら <timestamp>-<pid> 形式の suffix を生成する", () => {
    // timestamp (ms) がクロス時間方向のユニーク性 (PID 再利用 / cleanup 取りこぼし
    // 対策) を、PID が並行方向のユニーク性 (同一 ms 内に並行起動した別 supervisor
    // 同士の衝突回避) を担当。両者の組で乱数なしに構造的衝突不可。
    const base = mkdtempSync(join(tmpdir(), "sess-test-"))
    try {
      const sess = setupSessionTmpdir({ base })
      try {
        // 形式: securecode-<13 桁前後の ms timestamp>-<pid>
        const name = sess.path.split("/").pop()!
        expect(name).toMatch(new RegExp(`^securecode-\\d+-${process.pid}$`))
      } finally {
        sess.cleanup()
      }
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("cleanup は二重呼び出しでも throw しない (best-effort)", () => {
    const base = mkdtempSync(join(tmpdir(), "sess-test-"))
    try {
      const sess = setupSessionTmpdir({ base, suffix: "double-cleanup" })
      sess.cleanup()
      expect(() => sess.cleanup()).not.toThrow()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("base に symlink が含まれていれば canonical path に展開する", () => {
    // macOS の os.tmpdir() は `/var/folders/...` を返すが `/var → /private/var` の
    // symlink で、Seatbelt は canonical path で評価する。allowWrite に登録する文字列が
    // canonical 一致していないと sandbox 内の write が拒否される (JDTLS / TUI external
    // editor / clipboard が動かなくなる)。`setupSessionTmpdir` が realpath を取って
    // canonical path を返すことを、symlink 経由の base を渡して確認する。
    const realBase = mkdtempSync(join(realpathSync(tmpdir()), "sess-test-real-"))
    const linkBase = join(realpathSync(tmpdir()), `sess-test-link-${process.pid}-${Math.floor(performance.now())}`)
    symlinkSync(realBase, linkBase)
    try {
      const sess = setupSessionTmpdir({ base: linkBase, suffix: "canonical" })
      try {
        // 返り値は realBase 側 (canonical) を起点としていること。
        expect(sess.path).toBe(join(realBase, "securecode-canonical"))
        expect(sess.path.startsWith(linkBase)).toBe(false)
        expect(existsSync(sess.path)).toBe(true)
      } finally {
        sess.cleanup()
      }
    } finally {
      rmSync(linkBase, { force: true })
      rmSync(realBase, { recursive: true, force: true })
    }
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

describe("buildSandboxConfig (runtimeDir 周り)", () => {
  test("runtimeDir 指定時、denyWrite に末尾追加される", () => {
    const cfg = buildSandboxConfig(makeConfig(), { runtimeDir: "/tmp/securecode-runtime/123" })
    expect(cfg.filesystem.denyWrite).toContain("/tmp/securecode-runtime/123")
  })

  test("runtimeDir 指定 + user.allowRead 未指定なら allowRead は undefined のまま (全許可)", () => {
    const cfg = buildSandboxConfig(makeConfig(), { runtimeDir: "/tmp/r/1" })
    expect(cfg.filesystem.allowRead).toBeUndefined()
  })

  test("runtimeDir + user.allowRead 指定なら allowRead に runtimeDir が append される", () => {
    const cfg = buildSandboxConfig(makeConfig({ filesystem: { allowRead: ["/workspace"] } }), {
      runtimeDir: "/tmp/r/1",
    })
    expect(cfg.filesystem.allowRead).toEqual(["/workspace", "/tmp/r/1"])
  })

  test("runtimeDir 未指定なら denyWrite に runtime dir は入らない", () => {
    const cfg = buildSandboxConfig(makeConfig())
    expect(cfg.filesystem.denyWrite).toEqual([CONFIG_PATH])
  })
})

describe("computeSandboxConfigHash", () => {
  test("空配列でも deterministic な hash を返す", () => {
    expect(computeSandboxConfigHash([])).toMatch(/^[0-9a-f]{64}$/)
  })

  test("単一パス・ファイル不在でも deterministic、パスが違えば hash も変わる", () => {
    const h = computeSandboxConfigHash(["/nonexistent/securecode-test/sandbox.json"])
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toBe(computeSandboxConfigHash(["/nonexistent/another/sandbox.json"]))
  })

  test("同じ内容・同じパスなら同じハッシュ", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-hash-"))
    const p = join(dir, "x.json")
    writeFileSync(p, '{"network":{"allowedDomains":["foo.com"]}}')
    try {
      expect(computeSandboxConfigHash([p])).toBe(computeSandboxConfigHash([p]))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("内容が違えばハッシュが変わる", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-hash-"))
    const p = join(dir, "x.json")
    writeFileSync(p, '{"a":1}')
    const h1 = computeSandboxConfigHash([p])
    writeFileSync(p, '{"a":2}')
    const h2 = computeSandboxConfigHash([p])
    try {
      expect(h1).not.toBe(h2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("複数パス: project 側だけ変わっても全体 hash が変わる", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-multihash-"))
    const g = join(dir, "global.json")
    const p = join(dir, "project.json")
    writeFileSync(g, '{"network":{"allowedDomains":["g.com"]}}')
    writeFileSync(p, '{"network":{"allowedDomains":["p1.com"]}}')
    const h1 = computeSandboxConfigHash([g, p])
    writeFileSync(p, '{"network":{"allowedDomains":["p2.com"]}}')
    const h2 = computeSandboxConfigHash([g, p])
    try {
      expect(h1).not.toBe(h2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("複数パス: 「不在 → 作成」の遷移も hash 変化として検知できる", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-absenthash-"))
    const g = join(dir, "global.json")
    const p = join(dir, "project.json")
    writeFileSync(g, '{"network":{"allowedDomains":["g.com"]}}')
    const h1 = computeSandboxConfigHash([g, p])
    writeFileSync(p, '{"network":{"allowedDomains":["p.com"]}}')
    const h2 = computeSandboxConfigHash([g, p])
    try {
      expect(h1).not.toBe(h2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("tryLoadUserConfig", () => {
  test("ファイル不在は ok=true で全フィールド空配列の正規化 config", () => {
    const r = tryLoadUserConfig("/nonexistent/securecode-test/sandbox.json")
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.network.allowedDomains).toEqual([])
      expect(r.value.filesystem.denyRead).toEqual([])
    }
  })

  test("正常な JSON は ok=true で正規化された config を返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-tryload-"))
    const p = join(dir, "sandbox.json")
    writeFileSync(p, '{"network":{"allowedDomains":["foo.com"]}}')
    try {
      const r = tryLoadUserConfig(p)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.network.allowedDomains).toEqual(["foo.com"])
        expect(r.value.network.deniedDomains).toEqual([])
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("不正な JSON は ok=false で error を返す (process.exit しない)", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-tryload-"))
    const p = join(dir, "sandbox.json")
    writeFileSync(p, "{ not valid json")
    try {
      const r = tryLoadUserConfig(p)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain("JSON")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("resolveReload (reload 1 イテレーションの決定論)", () => {
  test("loadResult.ok=true なら新しい config / hash を返す", () => {
    const prev = makeConfig({ network: { allowedDomains: ["old.com"] } })
    const next = makeConfig({ network: { allowedDomains: ["new.com"] } })
    const result = resolveReload({
      prevConfig: prev,
      prevHash: "old-hash",
      loadResult: { ok: true, value: next },
      newHash: "new-hash",
    })
    expect(result.nextConfig.network.allowedDomains).toEqual(["new.com"])
    expect(result.nextHash).toBe("new-hash")
    expect(result.error).toBeUndefined()
  })

  test("loadResult.ok=false なら旧 config / 旧 hash を保ち、error を埋める", () => {
    const prev = makeConfig({ network: { allowedDomains: ["old.com"] } })
    const result = resolveReload({
      prevConfig: prev,
      prevHash: "old-hash",
      loadResult: { ok: false, error: "Unexpected token" },
      newHash: "new-hash-ignored",
    })
    expect(result.nextConfig.network.allowedDomains).toEqual(["old.com"])
    expect(result.nextHash).toBe("old-hash")
    expect(result.error).toBe("Unexpected token")
  })
})

describe("prepareRuntimeDir / writeHashFile", () => {
  test("runtime dir を作成し、再呼び出しで内容をリセットする", () => {
    const base = mkdtempSync(join(tmpdir(), "securecode-rtbase-"))
    try {
      const dir = prepareRuntimeDir(999, base)
      expect(existsSync(dir)).toBe(true)
      writeFileSync(join(dir, "leftover"), "stale")
      const dir2 = prepareRuntimeDir(999, base)
      expect(dir2).toBe(dir)
      expect(existsSync(join(dir, "leftover"))).toBe(false)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("writeHashFile は中間 tmp ファイルを残さず atomic に書く", () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-hashw-"))
    try {
      const target = join(dir, "current-hash")
      writeHashFile(target, "abcd1234")
      expect(readFileSync(target, "utf8")).toBe("abcd1234")
      expect(existsSync(`${target}.tmp`)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("startSandboxConfigWatcher", () => {
  test("単一パス: sandbox.json の変更を debounce 経由で検知して current-hash を更新する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "securecode-watch-"))
    const configPath = join(dir, "sandbox.json")
    const currentHashFile = join(dir, "current-hash")
    writeFileSync(configPath, '{"network":{"allowedDomains":["a.com"]}}')
    writeHashFile(currentHashFile, computeSandboxConfigHash([configPath]))
    const initial = readFileSync(currentHashFile, "utf8")
    const stop = startSandboxConfigWatcher({ configPaths: [configPath], currentHashFile, debounceMs: 30 })
    try {
      // macOS の fs.watch (FSEvents) は watcher のセットアップが非同期で、watch()
      // 直後の書き込みイベントを取りこぼすことがある。固定 sleep だと flaky になる
      // ため、反映を確認できるまで書き込みを繰り返すリトライ形式にする。
      const deadline = Date.now() + 5000
      let after = initial
      while (after === initial && Date.now() < deadline) {
        writeFileSync(configPath, '{"network":{"allowedDomains":["b.com"]}}')
        writeFileSync(configPath, '{"network":{"allowedDomains":["c.com"]}}')
        await new Promise((r) => setTimeout(r, 100))
        after = readFileSync(currentHashFile, "utf8")
      }
      expect(after).not.toBe(initial)
      expect(after).toBe(computeSandboxConfigHash([configPath]))
    } finally {
      stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("global + project: project 側の変更だけでも current-hash が更新される", async () => {
    const gDir = mkdtempSync(join(tmpdir(), "securecode-watch-g-"))
    const pDir = mkdtempSync(join(tmpdir(), "securecode-watch-p-"))
    const globalPath = join(gDir, "sandbox.json")
    const projectPath = join(pDir, "sandbox.json")
    const currentHashFile = join(gDir, "current-hash")
    writeFileSync(globalPath, '{"network":{"allowedDomains":["g.com"]}}')
    const configPaths = [globalPath, projectPath]
    writeHashFile(currentHashFile, computeSandboxConfigHash(configPaths))
    const initial = readFileSync(currentHashFile, "utf8")
    const stop = startSandboxConfigWatcher({ configPaths, currentHashFile, debounceMs: 30 })
    try {
      const deadline = Date.now() + 5000
      let after = initial
      while (after === initial && Date.now() < deadline) {
        writeFileSync(projectPath, '{"network":{"allowedDomains":["p1.com"]}}')
        writeFileSync(projectPath, '{"network":{"allowedDomains":["p2.com"]}}')
        await new Promise((r) => setTimeout(r, 100))
        after = readFileSync(currentHashFile, "utf8")
      }
      expect(after).not.toBe(initial)
      expect(after).toBe(computeSandboxConfigHash(configPaths))
    } finally {
      stop()
      rmSync(gDir, { recursive: true, force: true })
      rmSync(pDir, { recursive: true, force: true })
    }
  })
})

describe("buildRespawnArgs", () => {
  test("引数なしなら --continue だけ付与する", () => {
    expect(buildRespawnArgs([])).toEqual(["--continue"])
  })

  test("--prompt とその値を除去する (初期プロンプトの再送防止)", () => {
    expect(buildRespawnArgs(["--prompt", "fix the bug", "--model", "m"])).toEqual(["--model", "m", "--continue"])
  })

  test("--prompt=値 形式も除去する", () => {
    expect(buildRespawnArgs(["--prompt=fix the bug"])).toEqual(["--continue"])
  })

  test("既に --continue があれば二重付与しない", () => {
    expect(buildRespawnArgs(["--continue"])).toEqual(["--continue"])
  })

  test("--session 指定時は --continue を付与しない (同セッション継続)", () => {
    expect(buildRespawnArgs(["--session", "abc"])).toEqual(["--session", "abc"])
    expect(buildRespawnArgs(["--session=abc"])).toEqual(["--session=abc"])
  })

  test("その他の引数 (positional / フラグ) は保持し、入力配列を変更しない", () => {
    const base = ["/path/to/project", "--model", "m"]
    expect(buildRespawnArgs(base)).toEqual(["/path/to/project", "--model", "m", "--continue"])
    expect(base).toEqual(["/path/to/project", "--model", "m"])
  })
})

describe("cleanupStaleRuntimeDirs", () => {
  test("死んだ pid の dir だけ削除し、生きている pid と非数値名は残す", () => {
    const base = mkdtempSync(join(tmpdir(), "securecode-stale-"))
    try {
      mkdirSync(join(base, "100"), { recursive: true })
      mkdirSync(join(base, "200"), { recursive: true })
      mkdirSync(join(base, "not-a-pid"), { recursive: true })
      cleanupStaleRuntimeDirs(base, (pid) => pid === 200)
      expect(existsSync(join(base, "100"))).toBe(false)
      expect(existsSync(join(base, "200"))).toBe(true)
      expect(existsSync(join(base, "not-a-pid"))).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("base が存在しなくても throw しない", () => {
    expect(() => cleanupStaleRuntimeDirs("/nonexistent/securecode-test/runtime")).not.toThrow()
  })
})

describe("resetTerminal", () => {
  test("alternate screen 離脱とカーソル再表示の escape sequence を書く", () => {
    let buf = ""
    const out = { write: (s: string) => ((buf += s), true) } as unknown as NodeJS.WriteStream
    resetTerminal(out)
    expect(buf).toContain("\x1b[?1049l")
    expect(buf).toContain("\x1b[?25h")
  })
})
