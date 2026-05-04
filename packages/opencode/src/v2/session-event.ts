import { SessionID } from "@/session/schema"
import { NonNegativeInt } from "@/util/schema"
import { EventV2 } from "./event"
import { FileAttachment, Prompt } from "./session-prompt"
import { Schema } from "effect"
export { FileAttachment }
import { ToolOutput } from "./tool-output"
import { ModelID, ProviderID } from "@/provider/schema"
import { V2Schema } from "./schema"

export const Source = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
  text: Schema.String,
}).annotate({
  identifier: "session.next.event.source",
})
export type Source = Schema.Schema.Type<typeof Source>

const Base = {
  timestamp: V2Schema.DateTimeUtcFromMillis,
  sessionID: SessionID,
}

const Error = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
})

export const AgentSwitched = EventV2.define({
  type: "session.next.agent.switched",
  aggregate: "sessionID",
  version: 1,
  schema: {
    ...Base,
    agent: Schema.String,
  },
})
export type AgentSwitched = Schema.Schema.Type<typeof AgentSwitched>

export const ModelSwitched = EventV2.define({
  type: "session.next.model.switched",
  aggregate: "sessionID",
  version: 1,
  schema: {
    ...Base,
    id: ModelID,
    providerID: ProviderID,
    variant: Schema.String.pipe(Schema.optional),
  },
})
export type ModelSwitched = Schema.Schema.Type<typeof ModelSwitched>

export const Prompted = EventV2.define({
  type: "session.next.prompted",
  aggregate: "sessionID",
  version: 1,
  schema: {
    ...Base,
    prompt: Prompt,
  },
})
export type Prompted = Schema.Schema.Type<typeof Prompted>

export const Synthetic = EventV2.define({
  type: "session.next.synthetic",
  aggregate: "sessionID",
  schema: {
    ...Base,
    text: Schema.String,
  },
})
export type Synthetic = Schema.Schema.Type<typeof Synthetic>

export namespace Shell {
  export const Started = EventV2.define({
    type: "session.next.shell.started",
    aggregate: "sessionID",
    schema: {
      ...Base,
      callID: Schema.String,
      command: Schema.String,
    },
  })
  export type Started = Schema.Schema.Type<typeof Started>

  export const Ended = EventV2.define({
    type: "session.next.shell.ended",
    aggregate: "sessionID",
    schema: {
      ...Base,
      callID: Schema.String,
      output: Schema.String,
    },
  })
  export type Ended = Schema.Schema.Type<typeof Ended>
}

export namespace Step {
  export const Started = EventV2.define({
    type: "session.next.step.started",
    aggregate: "sessionID",
    schema: {
      ...Base,
      agent: Schema.String,
      model: Schema.Struct({
        id: Schema.String,
        providerID: Schema.String,
        variant: Schema.String.pipe(Schema.optional),
      }),
      snapshot: Schema.String.pipe(Schema.optional),
    },
  })
  export type Started = Schema.Schema.Type<typeof Started>

  export const Ended = EventV2.define({
    type: "session.next.step.ended",
    aggregate: "sessionID",
    schema: {
      ...Base,
      finish: Schema.String,
      cost: Schema.Finite,
      tokens: Schema.Struct({
        input: NonNegativeInt,
        output: NonNegativeInt,
        reasoning: NonNegativeInt,
        cache: Schema.Struct({
          read: NonNegativeInt,
          write: NonNegativeInt,
        }),
      }),
      snapshot: Schema.String.pipe(Schema.optional),
    },
  })
  export type Ended = Schema.Schema.Type<typeof Ended>

  export const Failed = EventV2.define({
    type: "session.next.step.failed",
    aggregate: "sessionID",
    schema: {
      ...Base,
      error: Error,
    },
  })
  export type Failed = Schema.Schema.Type<typeof Failed>
}

export namespace Text {
  export const Started = EventV2.define({
    type: "session.next.text.started",
    aggregate: "sessionID",
    schema: {
      ...Base,
    },
  })
  export type Started = Schema.Schema.Type<typeof Started>

  export const Delta = EventV2.define({
    type: "session.next.text.delta",
    aggregate: "sessionID",
    schema: {
      ...Base,
      delta: Schema.String,
    },
  })
  export type Delta = Schema.Schema.Type<typeof Delta>

  export const Ended = EventV2.define({
    type: "session.next.text.ended",
    aggregate: "sessionID",
    schema: {
      ...Base,
      text: Schema.String,
    },
  })
  export type Ended = Schema.Schema.Type<typeof Ended>
}

export namespace Reasoning {
  export const Started = EventV2.define({
    type: "session.next.reasoning.started",
    aggregate: "sessionID",
    schema: {
      ...Base,
      reasoningID: Schema.String,
    },
  })
  export type Started = Schema.Schema.Type<typeof Started>

  export const Delta = EventV2.define({
    type: "session.next.reasoning.delta",
    aggregate: "sessionID",
    schema: {
      ...Base,
      reasoningID: Schema.String,
      delta: Schema.String,
    },
  })
  export type Delta = Schema.Schema.Type<typeof Delta>

  export const Ended = EventV2.define({
    type: "session.next.reasoning.ended",
    aggregate: "sessionID",
    schema: {
      ...Base,
      reasoningID: Schema.String,
      text: Schema.String,
    },
  })
  export type Ended = Schema.Schema.Type<typeof Ended>
}

export namespace Tool {
  export namespace Input {
    export const Started = EventV2.define({
      type: "session.next.tool.input.started",
      aggregate: "sessionID",
      schema: {
        ...Base,
        callID: Schema.String,
        name: Schema.String,
      },
    })
    export type Started = Schema.Schema.Type<typeof Started>

    export const Delta = EventV2.define({
      type: "session.next.tool.input.delta",
      aggregate: "sessionID",
      schema: {
        ...Base,
        callID: Schema.String,
        delta: Schema.String,
      },
    })
    export type Delta = Schema.Schema.Type<typeof Delta>

    export const Ended = EventV2.define({
      type: "session.next.tool.input.ended",
      aggregate: "sessionID",
      schema: {
        ...Base,
        callID: Schema.String,
        text: Schema.String,
      },
    })
    export type Ended = Schema.Schema.Type<typeof Ended>
  }

  export const Called = EventV2.define({
    type: "session.next.tool.called",
    aggregate: "sessionID",
    schema: {
      ...Base,
      callID: Schema.String,
      tool: Schema.String,
      input: Schema.Record(Schema.String, Schema.Unknown),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
      }),
    },
  })
  export type Called = Schema.Schema.Type<typeof Called>

  export const Progress = EventV2.define({
    type: "session.next.tool.progress",
    aggregate: "sessionID",
    schema: {
      ...Base,
      callID: Schema.String,
      structured: ToolOutput.Structured,
      content: Schema.Array(ToolOutput.Content),
    },
  })
  export type Progress = Schema.Schema.Type<typeof Progress>

  export const Success = EventV2.define({
    type: "session.next.tool.success",
    aggregate: "sessionID",
    schema: {
      ...Base,
      callID: Schema.String,
      structured: ToolOutput.Structured,
      content: Schema.Array(ToolOutput.Content),
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
      }),
    },
  })
  export type Success = Schema.Schema.Type<typeof Success>

  export const Failed = EventV2.define({
    type: "session.next.tool.failed",
    aggregate: "sessionID",
    schema: {
      ...Base,
      callID: Schema.String,
      error: Error,
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
      }),
    },
  })
  export type Failed = Schema.Schema.Type<typeof Failed>
}

export const RetryError = Schema.Struct({
  message: Schema.String,
  statusCode: NonNegativeInt.pipe(Schema.optional),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  responseBody: Schema.String.pipe(Schema.optional),
  metadata: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
}).annotate({
  identifier: "session.next.retry_error",
})
export type RetryError = Schema.Schema.Type<typeof RetryError>

export const Retried = EventV2.define({
  type: "session.next.retried",
  aggregate: "sessionID",
  schema: {
    ...Base,
    attempt: NonNegativeInt,
    error: RetryError,
  },
})
export type Retried = Schema.Schema.Type<typeof Retried>

export namespace Compaction {
  export const Started = EventV2.define({
    type: "session.next.compaction.started",
    aggregate: "sessionID",
    schema: {
      ...Base,
      reason: Schema.Union([Schema.Literal("auto"), Schema.Literal("manual")]),
    },
  })
  export type Started = Schema.Schema.Type<typeof Started>

  export const Delta = EventV2.define({
    type: "session.next.compaction.delta",
    aggregate: "sessionID",
    schema: {
      ...Base,
      text: Schema.String,
    },
  })

  export const Ended = EventV2.define({
    type: "session.next.compaction.ended",
    aggregate: "sessionID",
    schema: {
      ...Base,
      text: Schema.String,
      include: Schema.String.pipe(Schema.optional),
    },
  })
  export type Ended = Schema.Schema.Type<typeof Ended>
}

export const All = Schema.Union(
  [
    AgentSwitched,
    ModelSwitched,
    Prompted,
    Synthetic,
    Shell.Started,
    Shell.Ended,
    Step.Started,
    Step.Ended,
    Step.Failed,
    Text.Started,
    Text.Delta,
    Text.Ended,
    Tool.Input.Started,
    Tool.Input.Delta,
    Tool.Input.Ended,
    Tool.Called,
    Tool.Progress,
    Tool.Success,
    Tool.Failed,
    Reasoning.Started,
    Reasoning.Delta,
    Reasoning.Ended,
    Retried,
    Compaction.Started,
    Compaction.Delta,
    Compaction.Ended,
  ],
  {
    mode: "oneOf",
  },
).pipe(Schema.toTaggedUnion("type"))

// user
// assistant
// assistant
// assistant
// user
// compaction marker
// -> text
// assistant

export type Event = Schema.Schema.Type<typeof All>
export type Type = Event["type"]

export * as SessionEvent from "./session-event"
