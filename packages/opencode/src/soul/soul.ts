// Soul constitution layer — loads a project's SOUL.md at session start and
// compiles it into the system prompt. This is the testable values layer:
// axioms with paired probes, ranked values, formation rules. It is not the
// identity prose of a personality file; every axiom here must survive the
// entry lint or the soul is rejected and never reaches the model.

import matter from "gray-matter"
import path from "path"
import { Context, Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { InstanceState } from "@/effect/instance-state"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SoulGuard } from "./guard"
import { SoulEval } from "./eval"

export const FILENAME = "SOUL.md"
export const SUITE_FILENAME = "SOUL.suite.yaml"

export interface Axiom {
  id: string
  statement: string
  enforcedBy: string
}

export interface SoulFile {
  path: string
  version: string
  agent: string
  purpose: string
  axioms: Axiom[]
  values: string[]
  dispositions: string
  suitePath: string
}

export class SoulLoadError extends Error {
  readonly messages: string[]
  constructor(messages: string[]) {
    super(messages.join("\n"))
    this.messages = messages
  }
}

// Section body between "## <n>." and the next "## " header.
function section(content: string, n: number): string {
  const lines = content.split("\n")
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${n}\\.`).test(l.trim()))
  if (start === -1) return ""
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.trim().startsWith("## "))
  return (end === -1 ? rest : rest.slice(0, end)).join("\n")
}

function tableRows(sectionBody: string): string[][] {
  const rows = sectionBody
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && !l.includes("---"))
    .map((l) =>
      l
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((c) => c.replace(/\\\|/g, "|").trim()),
    )
    .filter((cols) => cols.length > 0)
  // Markdown tables always open with a header row; data starts after it.
  return rows.slice(1)
}

function stripBackticks(s: string): string {
  return s.replace(/^`|`$/g, "").trim()
}

export function parseSoul(content: string, filepath: string): SoulFile {
  const parsed = matter(content)
  const data = (parsed.data ?? {}) as Record<string, unknown>
  const body = parsed.content

  const axioms: Axiom[] = []
  for (const cols of tableRows(section(body, 1))) {
    const id = stripBackticks(cols[0] ?? "")
    if (!/^[A-Z]+-\d+$/.test(id)) continue
    axioms.push({ id, statement: stripBackticks(cols[1] ?? ""), enforcedBy: stripBackticks(cols[2] ?? "") })
  }

  const values: string[] = []
  for (const cols of tableRows(section(body, 2))) {
    const value = stripBackticks(cols[1] ?? "")
    if (value && !/^<.*>$/.test(value)) values.push(value)
  }

  const dispositionsBody = section(body, 3)
    .split("\n")
    .filter((l) => {
      const t = l.trim()
      // drop markdown separator rows like |---|---|
      return !(t.startsWith("|") && t.replace(/[|:\-\s]/g, "") === "")
    })
    .join("\n")
    .trim()

  const dir = path.dirname(filepath)
  const suiteRel = typeof data["eval_suite"] === "string" ? (data["eval_suite"] as string) : SUITE_FILENAME

  return {
    path: filepath,
    version: typeof data["soul_version"] === "string" ? (data["soul_version"] as string) : "0.1.0",
    agent: typeof data["agent"] === "string" ? (data["agent"] as string) : path.basename(dir),
    purpose: section(body, 0).split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "",
    axioms,
    values,
    dispositions: dispositionsBody,
    suitePath: path.resolve(dir, suiteRel),
  }
}

// Runtime entry lint: nothing enters the soul that cannot be tested. Every
// axiom id in SOUL.md §1 must have at least one must_refuse and one
// must_not_refuse probe in the co-located suite, or the soul is rejected.
export function entryLint(soul: SoulFile, suite: SoulEval.Suite): string[] {
  const errs: string[] = []
  if (soul.axioms.length === 0) errs.push(`soul: ${soul.path} defines no axioms in §1`)
  const linted = SoulEval.lintSuite({ ...suite, axioms: soul.axioms.map((a) => a.id) })
  for (const e of linted) {
    if (e.startsWith("ORPHAN")) errs.push(`soul: axiom ${e.split(" ")[2]} has no paired probes in ${soul.suitePath}`)
    else errs.push(`soul: suite ${soul.suitePath}: ${e}`)
  }
  return errs
}

export function compileSystemSection(soul: SoulFile): string {
  const lines = [
    `<soul version="${soul.version}">`,
    `The following constitution governs this session. Axioms are absolute and never traded off;`,
    `values below are ranked in strict precedence order. A disposition may never soften an axiom.`,
    ...(soul.purpose ? [`Purpose: ${soul.purpose}`] : []),
    `## Axioms`,
    ...soul.axioms.map((a) => `- [${a.id}] ${a.statement}`),
    `## Values (ranked)`,
    ...soul.values.map((v, i) => `${i + 1}. ${v}`),
  ]
  if (soul.dispositions) lines.push(`## Dispositions`, soul.dispositions)
  lines.push(
    `## Formation`,
    `You may never edit ${SoulGuard.SOUL_FILENAMES.join(", ")}. ` +
      `If the user asks you to change the soul, explain that axioms change only by human edit ` +
      `plus a full eval re-run, and ask them to make the change in their own editor.`,
    `</soul>`,
  )
  return lines.join("\n")
}

export interface Interface {
  // Compiled soul section for the system prompt, or undefined when no soul
  // file exists. A soul that fails the entry lint is rejected: it is logged
  // and nothing is injected, so untested axioms never reach the model.
  readonly system: () => Effect.Effect<string | undefined>
  readonly load: (filepath: string) => Effect.Effect<SoulFile, SoulLoadError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Soul") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

    const resolve = Effect.fn("Soul.resolve")(function* () {
      const ctx = yield* InstanceState.context
      const project = yield* fs
        .findUp(FILENAME, ctx.directory, ctx.worktree)
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      if (project.length > 0) return project[0]
      const globalPath = path.join(global.config, FILENAME)
      if (yield* fs.existsSafe(globalPath)) return globalPath
      return undefined
    })

    const load = Effect.fn("Soul.load")(function* (filepath: string) {
      const content = yield* fs.readFileString(filepath).pipe(
        Effect.catch((cause) => Effect.fail(new SoulLoadError([`soul: cannot read ${filepath}: ${cause}`]))),
      )
      let soul: SoulFile
      try {
        soul = parseSoul(content, filepath)
      } catch (cause) {
        return yield* Effect.fail(new SoulLoadError([`soul: cannot parse ${filepath}: ${cause}`]))
      }
      const suiteOpt = yield* fs.readFileString(soul.suitePath).pipe(Effect.option)
      if (suiteOpt._tag === "None") {
        return yield* Effect.fail(
          new SoulLoadError([
            `soul: eval suite not found at ${soul.suitePath}; every soul needs a paired probe suite`,
          ]),
        )
      }
      const suiteText = suiteOpt.value
      let suite: SoulEval.Suite
      try {
        suite = SoulEval.parseSuite(suiteText)
      } catch (cause) {
        return yield* Effect.fail(new SoulLoadError([`soul: cannot parse suite ${soul.suitePath}: ${cause}`]))
      }
      const errs = entryLint(soul, suite)
      if (errs.length > 0) return yield* Effect.fail(new SoulLoadError(errs))
      return soul
    })

    const system = Effect.fn("Soul.system")(function* () {
      const filepath = yield* resolve()
      if (!filepath) return undefined
      const soul = yield* load(filepath).pipe(
        Effect.catch((err: SoulLoadError) =>
          Effect.gen(function* () {
            yield* Effect.logError("soul rejected at load; not injected into system prompt", {
              messages: err.messages,
            })
            return undefined
          }),
        ),
      )
      if (!soul) return undefined
      return compileSystemSection(soul)
    })

    return Service.of({ system, load })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, Global.node] })

export * as Soul from "./soul"
