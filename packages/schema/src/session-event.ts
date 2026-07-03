export * as SessionEvent from "./session-event.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { Event } from "./event.js"
import { ProviderMetadata, ToolContent } from "./llm.js"
import { Delivery } from "./session-delivery.js"
import { Model } from "./model.js"
import { NonNegativeInt, RelativePath } from "./schema.js"
import { FileAttachment, Prompt } from "./prompt.js"
import { SessionID } from "./session-id.js"
import { Location } from "./location.js"
import { SessionMessage } from "./session-message.js"
import { Revert } from "./revert.js"
import { Shell as ShellSchema } from "./shell.js"

export { FileAttachment }

export const Source = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
  text: Schema.String,
}).annotate({
  identifier: "session.event.source",
})
export interface Source extends Schema.Schema.Type<typeof Source> {}

const Base = {
  sessionID: SessionID,
}
const PromptFields = {
  ...Base,
  inputID: SessionMessage.ID,
  prompt: Prompt,
  delivery: Delivery,
}

const options = {
  durable: {
    aggregate: "sessionID",
    version: 1,
  },
} as const
const stepSettlementOptions = {
  durable: {
    aggregate: "sessionID",
    version: 1,
  },
} as const

export const UnknownError = SessionMessage.UnknownError
export type UnknownError = SessionMessage.UnknownError

export const AgentSelected = Event.durable({
  type: "session.agent.selected",
  ...options,
  schema: {
    ...Base,
    agent: Schema.String,
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

export const PromptPromoted = Event.durable({
  type: "session.prompt.promoted",
  ...options,
  schema: {
    sessionID: SessionID,
    inputID: SessionMessage.ID,
  },
})
export type PromptPromoted = typeof PromptPromoted.Type

export const PromptAdmitted = Event.durable({
  type: "session.prompt.admitted",
  ...options,
  schema: PromptFields,
})
export type PromptAdmitted = typeof PromptAdmitted.Type

export const ExecutionSettled = Event.ephemeral({
  type: "session.execution.settled",
  schema: {
    ...Base,
    outcome: Schema.Literals(["success", "failure", "interrupted"]),
    error: UnknownError.pipe(optional),
  },
})
export type ExecutionSettled = typeof ExecutionSettled.Type

export const ContextUpdated = Event.durable({
  type: "session.context.updated",
  ...options,
  schema: {
    ...Base,
    text: Schema.String,
  },
})
export type ContextUpdated = typeof ContextUpdated.Type

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
      name: Schema.String,
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
      agent: Schema.String,
      model: Model.Ref,
      snapshot: Schema.String.pipe(optional),
    },
  })
  export type Started = typeof Started.Type

  export const Ended = Event.durable({
    type: "session.step.ended",
    ...stepSettlementOptions,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      finish: Schema.String,
      cost: Schema.Finite,
      tokens: Schema.Struct({
        input: Schema.Finite,
        output: Schema.Finite,
        reasoning: Schema.Finite,
        cache: Schema.Struct({
          read: Schema.Finite,
          write: Schema.Finite,
        }),
      }),
      snapshot: Schema.String.pipe(optional),
      files: Schema.Array(RelativePath).pipe(optional),
    },
  })
  export type Ended = typeof Ended.Type

  export const Failed = Event.durable({
    type: "session.step.failed",
    ...stepSettlementOptions,
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      error: UnknownError,
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
      textID: Schema.String,
    },
  })
  export type Started = typeof Started.Type

  // Stream fragments are live-only; Text.Ended is the replayable full-value boundary.
  export const Delta = Event.ephemeral({
    type: "session.text.delta",
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      textID: Schema.String,
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
      textID: Schema.String,
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
      reasoningID: Schema.String,
      providerMetadata: ProviderMetadata.pipe(optional),
    },
  })
  export type Started = typeof Started.Type

  // Stream fragments are live-only; Reasoning.Ended is the replayable full-value boundary.
  export const Delta = Event.ephemeral({
    type: "session.reasoning.delta",
    schema: {
      ...Base,
      assistantMessageID: SessionMessage.ID,
      reasoningID: Schema.String,
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
      reasoningID: Schema.String,
      text: Schema.String,
      providerMetadata: ProviderMetadata.pipe(optional),
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
      tool: Schema.String,
      input: Schema.Record(Schema.String, Schema.Unknown),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optional),
      }),
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
      outputPaths: Schema.Array(Schema.String).pipe(optional),
      result: Schema.Unknown.pipe(optional),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optional),
      }),
    },
  })
  export type Success = typeof Success.Type

  export const Failed = Event.durable({
    type: "session.tool.failed",
    ...options,
    schema: {
      ...ToolBase,
      error: UnknownError,
      result: Schema.Unknown.pipe(optional),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: ProviderMetadata.pipe(optional),
      }),
    },
  })
  export type Failed = typeof Failed.Type
}

export const RetryError = Schema.Struct({
  message: Schema.String,
  statusCode: Schema.Finite.pipe(optional),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.Record(Schema.String, Schema.String).pipe(optional),
  responseBody: Schema.String.pipe(optional),
  metadata: Schema.Record(Schema.String, Schema.String).pipe(optional),
}).annotate({
  identifier: "session.retry.error",
})
export interface RetryError extends Schema.Schema.Type<typeof RetryError> {}

export const Retried = Event.durable({
  type: "session.retried",
  ...options,
  schema: {
    ...Base,
    attempt: Schema.Finite,
    error: RetryError,
  },
})
export type Retried = typeof Retried.Type

export namespace Compaction {
  export const Started = Event.durable({
    type: "session.compaction.started",
    ...options,
    schema: {
      ...Base,
      reason: Schema.Union([Schema.Literal("auto"), Schema.Literal("manual")]),
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
}

export namespace RevertEvent {
  export const Staged = Event.durable({
    type: "session.revert.staged",
    ...options,
    schema: { ...Base, revert: Revert.State },
  })
  export const Cleared = Event.durable({ type: "session.revert.cleared", ...options, schema: Base })
  export const Committed = Event.durable({
    type: "session.revert.committed",
    ...options,
    schema: { ...Base, messageID: SessionMessage.ID },
  })
}

export const Definitions = Event.inventory(
  AgentSelected,
  ModelSelected,
  Moved,
  Renamed,
  Forked,
  PromptPromoted,
  PromptAdmitted,
  ExecutionSettled,
  ContextUpdated,
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
  Retried,
  Compaction.Started,
  Compaction.Delta,
  Compaction.Ended,
  RevertEvent.Staged,
  RevertEvent.Cleared,
  RevertEvent.Committed,
)

export const DurableDefinitions = Event.inventory(
  ...Definitions.filter((definition) => definition.durability === "durable"),
)

export const Durable = Schema.Union(DurableDefinitions, { mode: "oneOf" })
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "SessionDurableEvent" })
export type DurableEvent = typeof Durable.Type

export const All = Schema.Union(Definitions, { mode: "oneOf" }).pipe(Schema.toTaggedUnion("type"))
export type Event = typeof All.Type
export type Type = Event["type"]
