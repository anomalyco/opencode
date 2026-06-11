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

async function must(args: string[], cwd = root) {
  const res = await cmd(args, cwd)
  if (res.code === 0) return res.out
  throw new Error(res.err || `command failed: ${args.join(" ")}`)
}

async function text(args: string[], cwd = root) {
  return await must(args, cwd)
}

async function ok(args: string[], cwd = root) {
  return (await cmd(args, cwd)).code === 0
}

async function git() {
  return await ok(["git", "rev-parse", "--git-dir"])
}

function out(key: string, value: string | boolean) {
  console.log(`${key}=${value}`)
}

function short(sha: string) {
  return sha.slice(0, 8)
}

function slug(url: string) {
  const ssh = url.match(/^git@github\.com:(.+?)(?:\.git)?$/)
  if (ssh) return ssh[1]
  const https = url.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/)
  if (https) return https[1]
  return ""
}

async function maybe(...list: string[]) {
  for (const item of list) {
    if (await ok(["git", "rev-parse", "--verify", item])) return item
  }
  return ""
}

async function tags(cfg: Cfg) {
  const out = await text(["git", "tag", "--list", cfg.upstream.pattern, "--sort=version:refname"])
  return out
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
}

async function latest(cfg: Cfg) {
  const list = await tags(cfg)
  if (list.length === 0) throw new Error(`missing upstream tags matching ${cfg.upstream.pattern}`)
  return list.at(-1) ?? cfg.upstream.seed
}

async function current(cfg: Cfg) {
  const base = await maybe(`${cfg.origin}/${cfg.base}`, cfg.base)
  if (!base) return cfg.upstream.seed

  const out = await text(["git", "log", "--first-parent", "--format=%s", base])
  for (const line of out.split("\n").map((x) => x.trim()).filter(Boolean)) {
    const hit = line.match(rx)
    if (hit?.[1]) return hit[1]
  }

  return cfg.upstream.seed
}

async function next(cfg: Cfg) {
  await must(["git", "fetch", cfg.upstream.remote, "--tags", "--force"])
  const from = await current(cfg)
  const tag = await latest(cfg)
  const list = await tags(cfg)
  const a = list.indexOf(from)
  const b = list.indexOf(tag)

  if (a === -1 || b === -1) {
    return { from, tag, need: from !== tag }
  }

  return { from, tag, need: b > a }
}

async function ensure(cfg: Cfg) {
  if (!(await ok(["git", "remote", "get-url", cfg.origin]))) {
    throw new Error(`missing git remote: ${cfg.origin}`)
  }

  if (await ok(["git", "remote", "get-url", cfg.upstream.remote])) return

  await must(["git", "remote", "add", cfg.upstream.remote, cfg.upstream.url])
}

async function cfgset(key: string, value: string) {
  await must(["git", "config", "--local", key, value])
}

async function cfgdel(key: string) {
  await cmd(["git", "config", "--local", "--unset-all", key])
}

async function clean(cfg: Cfg) {
  const out = await text(["git", "for-each-ref", `refs/remotes/${cfg.upstream.remote}`, "--format=%(refname)"])
  const keep = new Set([
    `refs/remotes/${cfg.upstream.remote}/${cfg.upstream.branch}`,
    `refs/remotes/${cfg.upstream.remote}/HEAD`,
  ])

  for (const ref of out.split("\n").map((x) => x.trim()).filter(Boolean)) {
    if (keep.has(ref)) continue
    await cmd(["git", "update-ref", "-d", ref])
  }
}

async function guard(cfg: Cfg) {
  if (!(await git())) return

  await ensure(cfg)
  await cfgset("push.default", "current")
  await cfgset("remote.pushDefault", cfg.origin)
  await cfgset(`branch.${cfg.base}.remote`, cfg.origin)
  await cfgset(`branch.${cfg.base}.merge`, `refs/heads/${cfg.base}`)
  await cfgdel(`remote.${cfg.upstream.remote}.fetch`)
  await cfgset(
    `remote.${cfg.upstream.remote}.fetch`,
    `+refs/heads/${cfg.upstream.branch}:refs/remotes/${cfg.upstream.remote}/${cfg.upstream.branch}`,
  )
  await cfgset(`remote.${cfg.upstream.remote}.prune`, "true")
  await must(["git", "remote", "set-url", "--push", cfg.upstream.remote, "no_push"])
  await cmd(["git", "fetch", cfg.upstream.remote, "--prune"])
  await clean(cfg)

  const url = await text(["git", "remote", "get-url", cfg.origin])
  const repo = slug(url)

  if (!repo) return
  if (!Bun.which("gh")) return


  await cmd(["gh", "repo", "set-default", repo])
}

async function check(cfg: Cfg, name: string, url: string) {
  await ensure(cfg)

  const remote = cfg.upstream.remote
  const want = slug(cfg.upstream.url)
  const have = slug(url)
  const push = await cmd(["git", "remote", "get-url", "--push", remote]).then((x) => (x.code === 0 ? x.out : ""))

  if (name === remote || url === remote || have === want) {
    console.error(`blocked push to upstream: ${cfg.upstream.url}`)
    process.exit(1)
  }

  if (push && push !== "no_push" && slug(push) === want) {
    console.error(`upstream pushurl is unsafe: ${push}`)
    process.exit(1)
  }
}

async function mirror(cfg: Cfg) {
  await ensure(cfg)
  await cmd(["git", "fetch", cfg.origin, cfg.base, cfg.upstream.mirror])
  const tag = await latest(cfg)
  const sha = await text(["git", "rev-list", "-n", "1", tag])
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

async function plan(cfg: Cfg) {
  await ensure(cfg)
  await cmd(["git", "fetch", cfg.origin, cfg.base, cfg.upstream.mirror])
  const item = await next(cfg)
  const sha = await text(["git", "rev-list", "-n", "1", item.tag])
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

async function sync(cfg: Cfg) {
  const item = await plan(cfg)

  if (!item.need) return

  await cmd(["git", "fetch", cfg.origin, cfg.base, cfg.upstream.mirror])
  const dir = await text(["mktemp", "-d"])

  let conflict = false
  let files: string[] = []

  try {
    await must(["git", "worktree", "add", "-B", item.head, dir, `${cfg.origin}/${cfg.base}`])

    const merge = await cmd(
      ["git", "merge", "--no-ff", "--no-edit", item.tag, "-m", `Merge tag '${item.tag}' into ${item.head}`],
      dir,
    )

    if (merge.code !== 0) {
      const status = await text(["git", "status", "--porcelain"], dir)
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
    await guard(cfg)
    return
  }

  if (cmd === "check-push") {
    await check(cfg, Bun.argv[3] ?? "", Bun.argv[4] ?? "")
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
