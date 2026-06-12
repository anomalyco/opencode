#!/usr/bin/env bun

type Cfg = {
  origin: string
  base: string
  upstream: {
    remote: string
    url: string
    branch: string
    mirror: string
    sync: string
    seed: string
    pattern: string
  }
}

type Plan = {
  base: string
  head: string
  need: boolean
  from: string
  sha: string
  short: string
  tag: string
}

const root = process.cwd()
const rx = /sync\/upstream-(v[0-9]+\.[0-9]+\.[0-9]+)/

async function file(path: string) {
  return JSON.parse(await Bun.file(path).text()) as Cfg
}

/** サブプロセス実行。 stdout / stderr / exit code をまとめて返し、失敗しても throw しない。 */
async function cmd(args: string[], cwd = root) {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = (await new Response(proc.stdout).text()).trim()
  const err = (await new Response(proc.stderr).text()).trim()
  const code = await proc.exited
  return { code, out, err }
}

/** サブプロセス実行。成功時は stdout を返し、失敗時は throw する。 */
async function must(args: string[], cwd = root) {
  const res = await cmd(args, cwd)
  if (res.code === 0) return res.out
  throw new Error(res.err || `command failed: ${args.join(" ")}`)
}

/** サブプロセスが成功 (exit 0) したかだけを真偽値で返す。stdout / stderr は捨てる。 */
async function ok(args: string[], cwd = root) {
  return (await cmd(args, cwd)).code === 0
}

/** GitHub Actions の $GITHUB_OUTPUT 形式 (key=value) で 1 行書き出す。 */
function out(key: string, value: string | boolean) {
  console.log(`${key}=${value}`)
}

function short(sha: string) {
  return sha.slice(0, 8)
}

const sshRx = /^git@github\.com:(.+?)(?:\.git)?$/
const httpsRx = /^https:\/\/github\.com\/(.+?)(?:\.git)?$/

/** git remote URL から "owner/repo" を抽出。SSH / HTTPS 両対応、抽出不能なら空文字。 */
function repoSlug(url: string) {
  const ssh = sshRx.exec(url)
  if (ssh) return ssh[1]
  const https = httpsRx.exec(url)
  if (https) return https[1]
  return ""
}

/** upstream の release tag を pattern マッチ + バージョン順ソートで列挙。 */
async function listUpstreamTags(cfg: Cfg) {
  const out = await must(["git", "tag", "--list", cfg.upstream.pattern, "--sort=version:refname"])
  return out
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
}

async function latestUpstreamTag(cfg: Cfg) {
  const list = await listUpstreamTags(cfg)
  if (list.length === 0) throw new Error(`missing upstream tags matching ${cfg.upstream.pattern}`)
  return list.at(-1) ?? cfg.upstream.seed
}

/**
 * version 順ソート済み tag list で from の直後の tag を返す。
 * - from が list に無い (= seed / unknown) → 最も古い tag から取り込む
 * - from が末尾 (= 既に最新) → from をそのまま返す (need=false で扱う)
 */
async function nextUpstreamTag(cfg: Cfg, from: string): Promise<string> {
  const list = await listUpstreamTags(cfg)
  const first = list[0]
  if (!first) throw new Error(`missing upstream tags matching ${cfg.upstream.pattern}`)
  const i = list.indexOf(from)
  if (i === -1) return first
  return list[i + 1] ?? from
}

/** base branch の merge commit subject を遡って最後に取り込んだ upstream tag を推定 (fallback: origin/<base> → <base> → seed)。 */
async function currentSyncedTag(cfg: Cfg) {
  const remote = `${cfg.origin}/${cfg.base}`
  let base = ""
  if (await ok(["git", "rev-parse", "--verify", remote])) base = remote
  else if (await ok(["git", "rev-parse", "--verify", cfg.base])) base = cfg.base
  if (!base) return cfg.upstream.seed

  const out = await must(["git", "log", "--first-parent", "--format=%s", base])
  for (const line of out.split("\n").map((x) => x.trim()).filter(Boolean)) {
    const hit = rx.exec(line)
    if (hit?.[1]) return hit[1]
  }

  return cfg.upstream.seed
}

/** upstream tag を fetch し、現在 sync 済み tag の **直後の 1 つ** を次の取り込み先とする。最新には飛ばない。 */
async function computeNextSync(cfg: Cfg) {
  await must(["git", "fetch", cfg.upstream.remote, "--tags", "--force"])
  const from = await currentSyncedTag(cfg)
  const tag = await nextUpstreamTag(cfg, from)
  return { from, tag, need: tag !== from }
}

/** origin remote の存在を確認し、upstream remote が無ければ追加する。 */
async function ensureRemotes(cfg: Cfg) {
  if (!(await ok(["git", "remote", "get-url", cfg.origin]))) {
    throw new Error(`missing git remote: ${cfg.origin}`)
  }

  if (await ok(["git", "remote", "get-url", cfg.upstream.remote])) return

  await must(["git", "remote", "add", cfg.upstream.remote, cfg.upstream.url])
}

async function cfgset(key: string, value: string) {
  await must(["git", "config", "--local", key, value])
}

/** upstream remote 配下の追跡 ref から sync 対象 branch と HEAD 以外を削除する。 */
async function pruneStaleUpstreamRefs(cfg: Cfg) {
  const out = await must(["git", "for-each-ref", `refs/remotes/${cfg.upstream.remote}`, "--format=%(refname)"])
  const keep = new Set([
    `refs/remotes/${cfg.upstream.remote}/${cfg.upstream.branch}`,
    `refs/remotes/${cfg.upstream.remote}/HEAD`,
  ])

  for (const ref of out.split("\n").map((x) => x.trim()).filter(Boolean)) {
    if (keep.has(ref)) continue
    await cmd(["git", "update-ref", "-d", ref])
  }
}

/**
 * local git config を sync 安全な状態に揃える。CI / 開発者環境両方で sync 前に呼ばれる。
 * - push.default / branch.*.remote を origin に固定し、upstream への暴発を防ぐ
 * - upstream remote は fetch のみ (push は no_push) / 対象 branch のみに絞り込む
 * - 不要な追跡 ref を掃除し、gh のデフォルト repo を origin に揃える
 */
async function configureSafeGitConfig(cfg: Cfg) {
  if (!(await ok(["git", "rev-parse", "--git-dir"]))) return

  await ensureRemotes(cfg)
  await cfgset("push.default", "current")
  await cfgset("remote.pushDefault", cfg.origin)
  await cfgset(`branch.${cfg.base}.remote`, cfg.origin)
  await cfgset(`branch.${cfg.base}.merge`, `refs/heads/${cfg.base}`)
  await cmd(["git", "config", "--local", "--unset-all", `remote.${cfg.upstream.remote}.fetch`])
  await cfgset(
    `remote.${cfg.upstream.remote}.fetch`,
    `+refs/heads/${cfg.upstream.branch}:refs/remotes/${cfg.upstream.remote}/${cfg.upstream.branch}`,
  )
  await cfgset(`remote.${cfg.upstream.remote}.prune`, "true")
  await must(["git", "remote", "set-url", "--push", cfg.upstream.remote, "no_push"])
  await cmd(["git", "fetch", cfg.upstream.remote, "--prune"])
  await pruneStaleUpstreamRefs(cfg)

  const url = await must(["git", "remote", "get-url", cfg.origin])
  const repo = repoSlug(url)

  if (!repo) return
  if (!Bun.which("gh")) return


  await cmd(["gh", "repo", "set-default", repo])
}

/** pre-push hook 相当。upstream remote / URL への push をブロックして fork での誤爆を防ぐ。 */
async function blockUpstreamPush(cfg: Cfg, name: string, url: string) {
  await ensureRemotes(cfg)

  const remote = cfg.upstream.remote
  const want = repoSlug(cfg.upstream.url)
  const have = repoSlug(url)
  const push = await cmd(["git", "remote", "get-url", "--push", remote]).then((x) => (x.code === 0 ? x.out : ""))

  if (name === remote || url === remote || have === want) {
    console.error(`blocked push to upstream: ${cfg.upstream.url}`)
    process.exit(1)
  }

  if (push && push !== "no_push" && repoSlug(push) === want) {
    console.error(`upstream pushurl is unsafe: ${push}`)
    process.exit(1)
  }
}

/** vendor/upstream-release branch を最新 upstream tag に強制更新して origin へ push (dev への merge 元固定 ref を提供)。 */
async function mirror(cfg: Cfg) {
  await ensureRemotes(cfg)
  await cmd(["git", "fetch", cfg.origin, cfg.base, cfg.upstream.mirror])
  const tag = await latestUpstreamTag(cfg)
  const sha = await must(["git", "rev-list", "-n", "1", tag])
  const head = `${cfg.origin}/${cfg.upstream.mirror}`
  const old = await cmd(["git", "rev-parse", head]).then((x) => (x.code === 0 ? x.out : ""))
  const changed = old !== sha

  await must(["git", "branch", "-f", cfg.upstream.mirror, tag])

  if (changed) {
    await must(["git", "push", cfg.origin, `${tag}:refs/heads/${cfg.upstream.mirror}`, "--force-with-lease"])
  }

  out("changed", changed)
  out("tag", tag)
  out("sha", sha)
  out("sha_short", short(sha))
}

/** 次の sync 計画 (from_tag / target tag / branch / sha) を計算し $GITHUB_OUTPUT に出す。merge は行わないドライラン。 */
async function plan(cfg: Cfg) {
  await ensureRemotes(cfg)
  await cmd(["git", "fetch", cfg.origin, cfg.base, cfg.upstream.mirror])
  const item = await computeNextSync(cfg)
  const sha = await must(["git", "rev-list", "-n", "1", item.tag])
  const data = {
    base: cfg.base,
    head: `${cfg.upstream.sync}-${item.tag}`,
    need: item.need,
    from: item.from,
    sha,
    short: short(sha),
    tag: item.tag,
  } satisfies Plan

  out("base", data.base)
  out("branch", data.head)
  out("needed", data.need)
  out("from_tag", data.from)
  out("tag", data.tag)
  out("sha", data.sha)
  out("sha_short", data.short)
  return data
}

/**
 * 一時 worktree で dev に upstream tag を merge し、sync branch を origin へ push する。
 * merge conflict は marker ごと commit して push し、$GITHUB_OUTPUT に conflict=true と conflict_files を出す。
 */
async function sync(cfg: Cfg) {
  const item = await plan(cfg)

  if (!item.need) return

  await cmd(["git", "fetch", cfg.origin, cfg.base, cfg.upstream.mirror])
  const dir = await must(["mktemp", "-d"])

  let conflict = false
  let files: string[] = []

  try {
    await must(["git", "worktree", "add", "-B", item.head, dir, `${cfg.origin}/${cfg.base}`])

    const merge = await cmd(
      ["git", "merge", "--no-ff", "--no-edit", item.tag, "-m", `Merge tag '${item.tag}' into ${item.head}`],
      dir,
    )

    if (merge.code !== 0) {
      const status = await must(["git", "status", "--porcelain"], dir)
      files = status
        .split("\n")
        .filter((line) => /^(UU|AA|DD|AU|UA|DU|UD) /.test(line))
        .map((line) => line.slice(3))

      if (files.length === 0) {
        throw new Error(merge.err || `git merge failed without conflicts: ${item.tag}`)
      }

      conflict = true
      const body = [
        `Merge tag '${item.tag}' into ${item.head} (CONFLICT - manual resolution required)`,
        "",
        "Conflict files:",
        ...files.map((f) => `- ${f}`),
      ].join("\n")
      await must(["git", "add", "-A"], dir)
      await must(["git", "commit", "-m", body], dir)
    }

    await must(["git", "push", cfg.origin, `HEAD:${item.head}`, "--force-with-lease"], dir)
  } finally {
    await cmd(["git", "worktree", "remove", "--force", dir])
  }

  out("created", true)
  out("conflict", conflict)
  console.log("conflict_files<<EOF")
  for (const f of files) console.log(f)
  console.log("EOF")
}

async function main() {
  const cfg = await file("securecode.config.json")
  const cmd = Bun.argv[2] ?? "help"

  if (cmd === "guard") {
    await configureSafeGitConfig(cfg)
    return
  }

  if (cmd === "check-push") {
    await blockUpstreamPush(cfg, Bun.argv[3] ?? "", Bun.argv[4] ?? "")
    return
  }

  if (cmd === "mirror") {
    await mirror(cfg)
    return
  }

  if (cmd === "plan") {
    await plan(cfg)
    return
  }

  if (cmd === "sync") {
    await sync(cfg)
    return
  }

  console.log("usage: bun script/upstream.ts [guard|check-push|mirror|plan|sync]")
}

await main()
