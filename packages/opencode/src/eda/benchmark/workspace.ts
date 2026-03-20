import { mkdir } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { BenchmarkManifest } from "./manifest"

export namespace BenchmarkWorkspace {
  export const ROOT = path.resolve(fileURLToPath(new URL("../../../../../benchmark", import.meta.url)))

  function part(input: number, size = 2) {
    return input.toString().padStart(size, "0")
  }

  function stamp(now: Date) {
    return {
      day: `${part(now.getFullYear() % 100)}-${part(now.getMonth() + 1)}-${part(now.getDate())}`,
      slot: `${part(now.getHours())}-${part(now.getMinutes())}-${part(now.getSeconds())}`,
    }
  }

  function clean(input?: string) {
    const next = input
      ?.toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
    return next || `pid-${process.pid}`
  }

  function base(input?: string) {
    return path.resolve(input ?? process.env.OPENCODE_BENCHMARK_ROOT ?? ROOT)
  }

  function pick(tag: string, i: number) {
    if (i === 0) return undefined
    if (i === 1) return tag
    return `${tag}-${part(i - 1)}`
  }

  function lines(gate: string, root: string) {
    return [`gate: ${gate}`, `status: pending`, `artifact_root: ${root}`, `notes: none`]
  }

  function file(dir: string, name?: string) {
    return path.join(dir, "benchmarks", name ?? "")
  }

  async function take(dir: string) {
    return mkdir(dir)
      .then(() => true)
      .catch((err) => {
        if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") return false
        throw err
      })
  }

  async function boot(dir: string, now: Date, gate: string) {
    await Promise.all([
      mkdir(path.join(dir, "logs"), { recursive: true }),
      mkdir(path.join(dir, "artifacts"), { recursive: true }),
      mkdir(path.join(dir, "artifacts", "manifests"), { recursive: true }),
      ...BenchmarkManifest.Suite.options.map((suite) => mkdir(file(dir, suite), { recursive: true })),
    ])
    await Promise.all([
      Bun.write(
        path.join(dir, "manifest.json"),
        JSON.stringify(
          {
            kind: "benchmark",
            gate,
            root: dir,
            status: "pending",
            created_at: now.toISOString(),
          },
          null,
          2,
        ),
      ),
      Bun.write(
        path.join(dir, "summary.json"),
        JSON.stringify(
          {
            gate,
            artifact_root: dir,
            status: "pending",
            notes: [],
          },
          null,
          2,
        ),
      ),
      Bun.write(path.join(dir, "summary.md"), `${lines(gate, dir).join("\n")}\n`),
    ])
  }

  export async function claim(input?: {
    root?: string
    now?: Date
    gate?: string
    tag?: string
  }) {
    const now = input?.now ?? new Date()
    const gate = input?.gate ?? "pending"
    const name = stamp(now)
    const root = base(input?.root)
    const head = path.join(root, name.day)
    const tag = clean(input?.tag)
    await mkdir(head, { recursive: true })
    let i = 0
    while (true) {
      const tail = pick(tag, i)
      const dir = path.join(head, tail ? `${name.slot}-${tail}` : name.slot)
      if (!(await take(dir))) {
        i += 1
        continue
      }
      await boot(dir, now, gate)
      return {
        root: dir,
        day: name.day,
        slot: name.slot,
        tag: tail,
      }
    }
  }

  export async function scope(root: string, suite: string, name: string) {
    const dir = path.join(root, "benchmarks", suite, name)
    await Promise.all([
      mkdir(path.join(dir, "artifacts"), { recursive: true }),
      mkdir(path.join(dir, "eda"), { recursive: true }),
    ])
    return { root: dir }
  }
}
