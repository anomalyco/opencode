export * as ContextInspection from "./inspect"

import { Effect } from "effect"
import { basename, relative } from "path"
import { AgentV2 } from "../agent"
import { FSUtil } from "../fs-util"
import { InstructionContext } from "../instruction-context"
import { Location } from "../location"
import { ReferenceGuidance } from "../reference/guidance"
import { SkillGuidance } from "../skill/guidance"
import { SystemContext } from "./index"
import { SystemContextRegistry } from "./registry"

export type Kind = "system" | "instructions" | "environment" | "skills" | "references"

export interface ContextSource {
  readonly key: string
  readonly kind: Kind
  readonly title: string
  readonly path?: string
  readonly editable: boolean
  readonly content: string
}

const AGENT_SYSTEM_KEY = "system/agent"

export const inspect = (agentID?: string) =>
  Effect.gen(function* () {
    const agent = yield* AgentV2.Service
    const registry = yield* SystemContextRegistry.Service
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const instructions = yield* InstructionContext.Service
    const location = yield* Location.Service

    const selection = yield* agent.select(agentID)
    const [registered, skillCtx, referenceCtx, files] = yield* Effect.all(
      [registry.inspect(), skillGuidance.load(selection), referenceGuidance.load(), instructions.list()],
      { concurrency: "unbounded" },
    )

    const sources: ContextSource[] = []

    for (const entry of registered) {
      if (entry.registryKey === "core/instructions") continue
      const content = entry.sources.map((source) => source.text).join("\n\n")
      if (content.length === 0) continue
      sources.push({
        key: entry.registryKey,
        kind: entry.registryKey === "core/builtins" ? "environment" : "instructions",
        title: entry.registryKey,
        editable: false,
        content,
      })
    }

    const directory = String(location.directory)
    for (const file of files) {
      const resolved = String(file.path)
      const editable = FSUtil.contains(directory, resolved) && basename(resolved) === "AGENTS.md"
      sources.push({
        key: `instructions/${resolved}`,
        kind: "instructions",
        title: editable ? relative(directory, resolved) : resolved,
        path: editable ? relative(directory, resolved) : undefined,
        editable,
        content: file.content,
      })
    }

    sources.push({
      key: AGENT_SYSTEM_KEY,
      kind: "system",
      title: `${selection.id} system prompt`,
      editable: true,
      content: selection.info?.system ?? "",
    })

    const guidance = [
      { ctx: skillCtx, kind: "skills" as Kind, fallback: "core/skill-guidance" },
      { ctx: referenceCtx, kind: "references" as Kind, fallback: "core/reference-guidance" },
    ]
    for (const { ctx, kind, fallback } of guidance) {
      const parts = yield* SystemContext.inspect(ctx)
      const content = parts.map((part) => part.text).join("\n\n")
      if (content.length === 0) continue
      sources.push({
        key: parts[0]?.key ?? fallback,
        kind,
        title: kind,
        editable: false,
        content,
      })
    }

    return sources
  })
