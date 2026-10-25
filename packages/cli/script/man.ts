#!/usr/bin/env bun
// Generates man pages from the yargs definitions by rendering each command's
// --help output to roff: dist/man/bolt.1 plus dist/man/bolt-<command>.1 for
// every top-level command, so `man bolt-run` works once dist/man is on the
// manpath. The dist dir is gitignored; only this generator is committed.

import path from "path"
import { fileURLToPath } from "url"
import pkg from "../package.json"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Escape one line of text for roff: double backslashes, neutralize control lines. */
export function escape(line: string) {
  const escaped = line.replaceAll("\\", "\\\\")
  if (escaped.startsWith(".") || escaped.startsWith("'")) return "\\&" + escaped
  return escaped
}

/** Render one man page from a command's plain-text --help output. */
export function page(name: string, version: string, date: string, help: string) {
  const lines = help.trimEnd().split("\n")
  const usage = lines[0]?.trim() || name
  const summary =
    lines
      .slice(1)
      .find((line) => line.trim())
      ?.trim() ?? ""
  return [
    `.TH "${name.toUpperCase()}" "1" "${date}" "bolt ${version}" "Bolt Manual"`,
    ".SH NAME",
    `${name} \\- ` + escape(summary),
    ".SH SYNOPSIS",
    ".B " + escape(usage),
    ".SH DESCRIPTION",
    ".nf",
    ...lines.map(escape),
    ".fi",
    "",
  ].join("\n")
}

/** Parse top-level command names out of the root --help output. */
export function commands(help: string) {
  const names = help
    .split("\n")
    .map((line) => line.match(/^\s{2}bolt (\S+)/)?.[1])
    .filter((name): name is string => !!name && /^[a-z][a-z-]*$/.test(name))
  return [...new Set(names)]
}

async function help(args: string[]) {
  const proc = Bun.spawn(["bun", "run", path.join(dir, "src/index.ts"), ...args, "--help"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  })
  const out = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  await proc.exited
  // yargs help is routed to stderr by the CLI entrypoint; keep stdout as a fallback.
  return err.trim() ? err : out
}

async function main() {
  const out = path.join(dir, "dist", "man")
  const version = process.env.BOLT_VERSION ?? pkg.version
  const date = new Date().toISOString().slice(0, 10)
  const root = await help([])
  // The root help is prefixed with the wordmark banner; start at the command list.
  const start = root.indexOf("Commands:")
  const body = start === -1 ? root : root.slice(start)
  await Bun.write(path.join(out, "bolt.1"), page("bolt", version, date, `bolt\n\nthe bolt CLI\n\n${body}`))
  const names = commands(body).filter((name) => name !== "completion")
  let done = 0
  for (const chunk of Array.from({ length: Math.ceil(names.length / 8) }, (_, i) => names.slice(i * 8, i * 8 + 8))) {
    await Promise.all(
      chunk.map(async (name) => {
        const text = await help([name])
        await Bun.write(path.join(out, `bolt-${name}.1`), page(`bolt-${name}`, version, date, text))
        done++
      }),
    )
    process.stderr.write(`man pages: ${done}/${names.length}\n`)
  }
  process.stderr.write(`wrote ${done + 1} man pages to ${out}\n`)
}

if (import.meta.main) await main()
