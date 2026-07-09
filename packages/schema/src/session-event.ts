export * as SessionEvent from "./session-event.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { Event } from "./event.js"
import { ToolContent } from "./llm.js"
import { FinishReason } from "./llm.js"
import { Model } from "./model.js"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema.js"
import { FileAttachment } from "./prompt.js"
import { SessionID } from "./session-id.js"
import { Location } from "./location.js"
import { SessionMessage } from "./session-message.js"
import { Revert } from "./session-revert.js"
import { Shell as ShellSchema } from "./shell.js"
import { SessionError } from "./session-error.js"
import { Agent } from "./agent.js"
import { Skill as SkillSchema } from "./skill.js"
import { Money } from "./money.js"
import { Snapshot } from "./snapshot.js"
import { TokenUsage } from "./token-usage.js"
import { SessionInput } from "./session-input.js"

export { FileAttachment }

export const Source = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
  text: Schema.String,
}).annotate({
  identifier: "Session.Event.Source",
})
export interface Source extends Schema.Schema.Type<typeof Source> {}

const Base = {
  sessionID: SessionID,
}

const options = {
  durable: {
    aggregate: "sessionID",
    version: 1,
  },
} as const
export const AgentSelected = Event.durable({
  type: "session.agent.selected",
  ...options,
  schema: {
    ...Base,
    agent: Agent.ID,
  },
})
export type AgentSelected = typeof AgentSelected.Type

export const ModelSelected = Event.durable({
  type: "session.model.selected",
  ...options,
  schema: {
    ...Base,
    model: Model.Ref,
  },
})
export type ModelSelected = typeof ModelSelected.Type

export const Moved = Event.durable({
  type: "session.moved",
  ...options,
  schema: {
    ...Base,
    location: Location.Ref,
    subpath: RelativePath.pipe(optional),
  },
})
export type Moved = typeof Moved.Type

export const Renamed = Event.durable({
  type: "session.renamed",
  ...options,
  schema: {
    ...Base,
    title: Schema.String,
  },
})
export type Renamed = typeof Renamed.Type

export const UsageUpdated = Event.ephemeral({
  type: "session.usage.updated",
  schema: {
    ...Base,
    cost: Money.USD,
    tokens: TokenUsage.Info,
  },
})
export type UsageUpdated = typeof UsageUpdated.Type

export const Deleted = Event.durable({
  type: "session.deleted",
  durable: {
    aggregate: "sessionID",
    version: 2,
  },
  schema: Base,
})
export type Deleted = typeof Deleted.Type

export const Forked = Event.durable({
  type: "session.forked",
  ...options,
  schema: {
    ...Base,
    parentID: SessionID,
    from: SessionMessage.ID.pipe(optional),
  },
})
export type Forked = typeof Forked.Type

export const InputPromoted = Event.durable({
  type: "session.input.promoted",
  ...options,
  schema: {
    sessionID: SessionID,
    inputID: SessionMessage.ID,
  },
})
export type InputPromoted = typeof InputPromoted.Type

export const InputAdmitted = Event.durable({
  type: "session.input.admitted",
  ...options,
  schema: {
    ...Base,
    inputID: SessionMessage.ID,
    input: SessionInput.Message,
  },
})
export type InputAdmitted = typeof InputAdmitted.Type

export namespace Execution {
  export const Started = Event.durable({ type: "session.execution.started", ...options, schema: Base })
  export type Started = typeof Started.Type

  export const Succeeded = Event.durable({ type: "session.execution.succeeded", ...options, schema: Base })
  export type Succeeded = typeof Succeeded.Type

  export const Failed = Event.durable({
    type: "session.execution.failed",
    ...options,
    schema: { ...Base, error: SessionError.Error },
  })
  export type Failed = typeof Failed.Type

  export const Interrupted = Event.durable({
    type: "session.execution.interrupted",
    ...options,
    schema: { ...Base, reason: Schema.Literals(["user", "shutdown", "superseded"]) },
  })
  export type Interrupted = typeof Interrupted.Type
}

export const InstructionsUpdated = Event.durable({
  type: "session.instructions.updated",
  ...options,
  schema: {
    ...Base,
    text: Schema.String,
  },
})
export type InstructionsUpdated = typeof InstructionsUpdated.Type

export const Synthetic = Event.durable({
  type: "session.synthetic",
  ...options,
  schema: {
    ...Base,
    text: Schema.String,
    description: Schema.String.pipe(optional),
    metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
  },
})
export type Synthetic = typeof Synthetic.Type

export namespace Skill {
  export const Activated = Event.durable({
    type: "session.skill.activated",
    ...options,
    schema: {
      ...Base,
      id: SkillSchema.ID,
      name: SkillSchema.Name,
      text: Schema.String,
    },
  })
  export type Activated = typeof Activated.Type
}

export namespace Shell {
  export const Started = Event.durable({
    type: "session.shell.started",
    ...options,
    schema: {
      ...Base,
      shell: ShellSchema.Info,
    },
  })
  export type Started = typeof Started.Type

  export const Ended = Event.durable({
    type: "session.shell.ended",
    ...options,
    schema: {
      ...Base,
      shell: ShellSchema.Info,
      output: ShellSchema.Output,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Step {
  export const Started = Event.durable({
    type: "session.step.started",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      agent: Agent.ID,
      model: Model.Ref,
      snapshot: Snapshot.ID.pipe(optional),
    },
  })
  export type Started = typeof Started.Type

  export const Ended = Event.durable({
    type: "session.step.ended",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      finish: FinishReason,
      cost: Money.USD,
      tokens: TokenUsage.Info,
      snapshot: Snapshot.ID.pipe(optional),
      files: Schema.Array(RelativePath).pipe(optional),
    },
  })
  export type Ended = typeof Ended.Type

  export const Failed = Event.durable({
    type: "session.step.failed",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      error: SessionError.Error,
      cost: Money.USD.pipe(optional),
      tokens: TokenUsage.Info.pipe(optional),
    },
  })
  export type Failed = typeof Failed.Type
}

export namespace Text {
  export const Started = Event.durable({
    type: "session.text.started",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      ordinal: NonNegativeInt,
    },
  })
  export type Started = typeof Started.Type

  // Stream fragments are live-only; Text.Ended is the replayable full-value boundary.
  export const Delta = Event.ephemeral({
    type: "session.text.delta",
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      ordinal: NonNegativeInt,
      delta: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = Event.durable({
    type: "session.text.ended",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      ordinal: NonNegativeInt,
      text: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Reasoning {
  export const Started = Event.durable({
    type: "session.reasoning.started",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      ordinal: NonNegativeInt,
      state: SessionMessage.ProviderState.pipe(optional),
    },
  })
  export type Started = typeof Started.Type

  // Stream fragments are live-only; Reasoning.Ended is the replayable full-value boundary.
  export const Delta = Event.ephemeral({
    type: "session.reasoning.delta",
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      ordinal: NonNegativeInt,
      delta: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = Event.durable({
    type: "session.reasoning.ended",
    ...options,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      ordinal: NonNegativeInt,
      text: Schema.String,
      state: SessionMessage.ProviderState.pipe(optional),
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Tool {
  const ToolBase = {
    ...Base,
    assistantMessageID: SessionMessage.ID,
    callID: Schema.String,
  }

  export namespace Input {
    export const Started = Event.durable({
      type: "session.tool.input.started",
      ...options,
      schema: {
        ...ToolBase,
        name: Schema.String,
      },
    })
    export type Started = typeof Started.Type

    // Stream fragments are live-only; Input.Ended is the replayable raw-input boundary.
    export const Delta = Event.ephemeral({
      type: "session.tool.input.delta",
      schema: {
        ...ToolBase,
        delta: Schema.String,
      },
    })
    export type Delta = typeof Delta.Type

    export const Ended = Event.durable({
      type: "session.tool.input.ended",
      ...options,
      schema: {
        ...ToolBase,
        text: Schema.String,
      },
    })
    export type Ended = typeof Ended.Type
  }

  export const Called = Event.durable({
    type: "session.tool.called",
    ...options,
    schema: {
      ...ToolBase,
      input: Schema.Record(Schema.String, Schema.Unknown),
      executed: Schema.Boolean,
      state: SessionMessage.ProviderState.pipe(optional),
    },
  })
  export type Called = typeof Called.Type

  /**
   * Replayable bounded running-tool state. Tools should checkpoint semantic
   * transitions or at a bounded cadence, not persist every stdout/stderr chunk.
   */
  export const Progress = Event.durable({
    type: "session.tool.progress",
    ...options,
    schema: {
      ...ToolBase,
      structured: Schema.Record(Schema.String, Schema.Unknown),
      content: Schema.Array(ToolContent),
    },
  })
  export type Progress = typeof Progress.Type

  export const Success = Event.durable({
    type: "session.tool.success",
    ...options,
    schema: {
      ...ToolBase,
      structured: Schema.Record(Schema.String, Schema.Unknown),
      content: Schema.Array(ToolContent),
      result: Schema.Unknown.pipe(optional),
      executed: Schema.Boolean,
      resultState: SessionMessage.ProviderState.pipe(optional),
    },
  })
  export type Success = typeof Success.Type

  export const Failed = Event.durable({
    type: "session.tool.failed",
    ...options,
    schema: {
      ...ToolBase,
      error: SessionError.Error,
      result: Schema.Unknown.pipe(optional),
      executed: Schema.Boolean,
      resultState: SessionMessage.ProviderState.pipe(optional),
    },
  })
  export type Failed = typeof Failed.Type
}

export const RetryScheduled = Event.durable({
  type: "session.retry.scheduled",
  ...options,
  schema: {
    ...Base,
    assistantMessageID: SessionMessage.ID,
    attempt: PositiveInt,
    at: NonNegativeInt,
    error: SessionError.Error,
  },
})
export type RetryScheduled = typeof RetryScheduled.Type

export namespace Compaction {
  export const Admitted = Event.durable({
    type: "session.compaction.admitted",
    ...options,
    schema: {
      ...Base,
      inputID: SessionMessage.ID,
    },
  })
  export type Admitted = typeof Admitted.Type

  export const Started = Event.durable({
    type: "session.compaction.started",
    ...options,
    schema: {
      ...Base,
      reason: Schema.Literals(["auto", "manual"]),
      recent: Schema.String,
      inputID: SessionMessage.ID.pipe(optional),
    },
  })
  export type Started = typeof Started.Type

  export const Delta = Event.ephemeral({
    type: "session.compaction.delta",
    schema: {
      ...Base,
      text: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = Event.durable({
    type: "session.compaction.ended",
    ...options,
    schema: {
      ...Base,
      reason: Started.data.fields.reason,
      text: Schema.String,
      recent: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type

  export const Failed = Event.durable({
    type: "session.compaction.failed",
    ...options,
    schema: {
      ...Base,
      reason: Started.data.fields.reason,
      error: SessionError.Error,
      inputID: SessionMessage.ID.pipe(optional),
    },
  })
  export type Failed = typeof Failed.Type
}

export namespace RevertEvent {
  export const Staged = Event.durable({
    type: "session.revert.staged",
    ...options,
    schema: { ...Base, revert: Revert },
  })
  export const Cleared = Event.durable({ type: "session.revert.cleared", ...options, schema: Base })
  export const Committed = Event.durable({
    type: "session.revert.committed",
    ...options,
    schema: { ...Base, to: SessionMessage.ID },
  })
}

export const Definitions = Event.inventory(
  AgentSelected,
  ModelSelected,
  Moved,
  Renamed,
  UsageUpdated,
  Deleted,
  Forked,
  InputPromoted,
  InputAdmitted,
  Execution.Started,
  Execution.Succeeded,
  Execution.Failed,
  Execution.Interrupted,
  InstructionsUpdated,
  Synthetic,
  Skill.Activated,
  Shell.Started,
  Shell.Ended,
  Step.Started,
  Step.Ended,
  Step.Failed,
  Text.Started,
  Text.Delta,
  Text.Ended,
  Reasoning.Started,
  Reasoning.Delta,
  Reasoning.Ended,
  Tool.Input.Started,
  Tool.Input.Delta,
  Tool.Input.Ended,
  Tool.Called,
  Tool.Progress,
  Tool.Success,
  Tool.Failed,
  RetryScheduled,
  Compaction.Admitted,
  Compaction.Started,
  Compaction.Delta,
  Compaction.Ended,
  Compaction.Failed,
  RevertEvent.Staged,
  RevertEvent.Cleared,
  RevertEvent.Committed,
)

export const DurableDefinitions = Event.inventory(
  ...Definitions.filter((definition) => definition.durability === "durable"),
)

export const Durable = Schema.Union(DurableDefinitions, { mode: "oneOf" })
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Session.Event.Durable" })
export type DurableEvent = typeof Durable.Type

export const All = Schema.Union(Definitions, { mode: "oneOf" }).pipe(Schema.toTaggedUnion("type"))
export type Event = typeof All.Type
export type Type = Event["type"]
