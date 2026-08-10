export * as SessionContext from "./context"

import { Context, Effect, Layer } from "effect"
import { Agent } from "../agent"
import { CodeModeInstructions } from "../codemode/instructions"
import { Database } from "../database/database"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { InstructionDiscovery } from "../instruction-discovery"
import { Instructions } from "../instructions/index"
import { InstructionBuiltIns } from "../instructions/builtins"
import { Location } from "../location"
import { McpInstructions } from "../mcp/instructions"
import { PluginSupervisor } from "../plugin/supervisor"
import { ReferenceInstructions } from "../reference/instructions"
import { SkillInstructions } from "../skill/instructions"
import { Tool } from "../tool"
import { AgentNotFoundError } from "./error"
import { SessionHistory } from "./history"
import { InstructionEntry } from "./instruction-entry"
import { SessionMessage } from "./message"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"

export interface Selection {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly instructions: Instructions.List
  readonly tools: Tool.Snapshot
}

export interface Loaded {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly model: SessionRunnerModel.Resolved
  readonly initial: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly tools: Tool.Snapshot
}

/**
 * Resolves model-request state in two phases: `select` fixes the Session,
 * agent, instruction sources, and tool snapshot; `load` adds the model and
 * active history for that selection. This module does not build or execute the
 * model request.
 */
export interface Interface {
  /** Selects the Session, agent, instructions, and tools used by subsequent work. */
  readonly select: (sessionID: SessionSchema.ID) => Effect.Effect<Selection, AgentNotFoundError>
  /** Resolves the model and active history for that selection. */
  readonly load: (selection: Selection) => Effect.Effect<Loaded, SessionRunnerModel.Error>
}

/** Location-scoped model-context loader for durable Session Steps. */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionContext") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const builtins = yield* InstructionBuiltIns.Service
    const db = (yield* Database.Service).db
    const discovery = yield* InstructionDiscovery.Service
    const entries = yield* InstructionEntry.Service
    const location = yield* Location.Service
    const mcpInstructions = yield* McpInstructions.Service
    const models = yield* SessionRunnerModel.Service
    const plugins = yield* PluginSupervisor.Service
    const referenceInstructions = yield* ReferenceInstructions.Service
    const skillInstructions = yield* SkillInstructions.Service
    const store = yield* SessionStore.Service
    const registry = yield* Tool.Service

    const select = Effect.fn("SessionContext.select")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt

      yield* plugins.flush
      const agent = yield* agents.select(session.agent)
      if (!agent.info) return yield* new AgentNotFoundError({ sessionID: session.id, agent: session.agent ?? agent.id })
      const loaded = yield* Effect.all(
        {
          tools: registry.snapshot(agent.info.permissions),
          builtins: builtins.load(sessionID),
          discovery: discovery.load(),
          skills: skillInstructions.load(agent),
          references: referenceInstructions.load(),
          mcp: mcpInstructions.load(agent),
          entries: entries.load(sessionID),
        },
        { concurrency: "unbounded" },
      )
      return {
        session,
        agent: { ...agent, info: agent.info },
        instructions: Instructions.combine([
          loaded.builtins,
          CodeModeInstructions.make(loaded.tools.codeModeCatalog),
          loaded.discovery,
          loaded.skills,
          loaded.references,
          loaded.mcp,
          loaded.entries,
        ]),
        tools: loaded.tools,
      }
    })

    const load = Effect.fn("SessionContext.load")(function* (selection: Selection) {
      const model = yield* models.resolve(selection.session)
      const history = yield* SessionHistory.entriesForRunner(db, selection.session.id, selection.instructions)
      return {
        session: selection.session,
        agent: selection.agent,
        model,
        initial: history.initial,
        messages: history.entries.map((entry) => entry.message),
        tools: selection.tools,
      }
    })

    return Service.of({ select, load })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Agent.node,
    Database.node,
    InstructionBuiltIns.node,
    InstructionDiscovery.node,
    InstructionEntry.node,
    Location.node,
    McpInstructions.node,
    PluginSupervisor.node,
    ReferenceInstructions.node,
    SessionRunnerModel.node,
    SessionStore.node,
    SkillInstructions.node,
    Tool.node,
  ],
})
