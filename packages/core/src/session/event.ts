import { Schema } from "effect"
import { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { NonNegativeInt } from "../schema"
import { ToolOutput } from "../tool-output"
import { V2Schema } from "../v2-schema"
import { FileAttachment, Prompt } from "./prompt"
import { SessionSchema } from "./schema"

export { FileAttachment }

export const Source = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
  text: Schema.String,
}).annotate({
  identifier: "session.next.event.source",
})
export type Source = typeof Source.Type

const Base = {
  timestamp: V2Schema.DateTimeUtcFromMillis,
  sessionID: SessionSchema.ID,
}

const options = {
  sync: {
    aggregate: "sessionID",
    version: 1,
  },
} as const

const mailboxOptions = {
  sync: {
    aggregate: "sessionID",
    version: 1,
  },
} as const

const backgroundOptions = {
  sync: {
    aggregate: "sessionID",
    version: 1,
  },
} as const

export const MailboxState = Schema.Literals(["queued", "processing", "delivered", "failed", "cancelled"]).annotate({
  identifier: "session.mailbox.state",
})
export type MailboxState = typeof MailboxState.Type

export const MailboxKind = Schema.Literals(["user", "inter_agent", "control"]).annotate({
  identifier: "session.mailbox.kind",
})
export type MailboxKind = typeof MailboxKind.Type

export const MailboxDelivery = Schema.Literals(["async", "interrupt"]).annotate({
  identifier: "session.mailbox.delivery",
})
export type MailboxDelivery = typeof MailboxDelivery.Type

const MailboxBase = {
  timestamp: V2Schema.DateTimeUtcFromMillis,
  sessionID: SessionSchema.ID,
  messageID: Schema.String,
  fromSessionID: SessionSchema.ID.pipe(Schema.optional),
  rootSessionID: SessionSchema.ID.pipe(Schema.optional),
  kind: MailboxKind,
  delivery: MailboxDelivery,
}

export namespace Mailbox {
  export const Enqueued = EventV2.define({
    type: "session.mailbox.enqueued",
    ...mailboxOptions,
    schema: {
      ...MailboxBase,
    },
  })
  export type Enqueued = typeof Enqueued.Type

  export const Processing = EventV2.define({
    type: "session.mailbox.processing",
    ...mailboxOptions,
    schema: {
      ...MailboxBase,
      claimID: Schema.String.pipe(Schema.optional),
    },
  })
  export type Processing = typeof Processing.Type

  export const Delivered = EventV2.define({
    type: "session.mailbox.delivered",
    ...mailboxOptions,
    schema: {
      ...MailboxBase,
    },
  })
  export type Delivered = typeof Delivered.Type

  export const Failed = EventV2.define({
    type: "session.mailbox.failed",
    ...mailboxOptions,
    schema: {
      ...MailboxBase,
      error: Schema.String.pipe(Schema.optional),
    },
  })
  export type Failed = typeof Failed.Type

  export const Cancelled = EventV2.define({
    type: "session.mailbox.cancelled",
    ...mailboxOptions,
    schema: {
      ...MailboxBase,
    },
  })
  export type Cancelled = typeof Cancelled.Type
}

const BackgroundBase = {
  timestamp: V2Schema.DateTimeUtcFromMillis,
  sessionID: SessionSchema.ID,
  parentSessionID: SessionSchema.ID,
  jobID: Schema.String,
  taskID: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
}

export namespace Background {
  export const Started = EventV2.define({
    type: "session.background.started",
    ...backgroundOptions,
    schema: {
      ...BackgroundBase,
    },
  })
  export type Started = typeof Started.Type

  export const Completed = EventV2.define({
    type: "session.background.completed",
    ...backgroundOptions,
    schema: {
      ...BackgroundBase,
    },
  })
  export type Completed = typeof Completed.Type

  export const Failed = EventV2.define({
    type: "session.background.failed",
    ...backgroundOptions,
    schema: {
      ...BackgroundBase,
      error: Schema.String.pipe(Schema.optional),
    },
  })
  export type Failed = typeof Failed.Type

  export const Cancelled = EventV2.define({
    type: "session.background.cancelled",
    ...backgroundOptions,
    schema: {
      ...BackgroundBase,
    },
  })
  export type Cancelled = typeof Cancelled.Type
}

export const UnknownError = Schema.Struct({
  type: Schema.Literal("unknown"),
  message: Schema.String,
}).annotate({
  identifier: "Session.Error.Unknown",
})
export type UnknownError = typeof UnknownError.Type

export const AssistantErrorAborted = Schema.Struct({
  type: Schema.Literal("aborted"),
  message: Schema.String,
}).annotate({
  identifier: "Session.Error.Assistant.Aborted",
})

export const AssistantErrorApi = Schema.Struct({
  type: Schema.Literal("api"),
  message: Schema.String,
  statusCode: NonNegativeInt.pipe(Schema.optional),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  responseBody: Schema.String.pipe(Schema.optional),
  metadata: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
}).annotate({
  identifier: "Session.Error.Assistant.Api",
})

export const AssistantErrorAuth = Schema.Struct({
  type: Schema.Literal("auth"),
  providerID: Schema.String,
  message: Schema.String,
}).annotate({
  identifier: "Session.Error.Assistant.Auth",
})

export const AssistantErrorContextOverflow = Schema.Struct({
  type: Schema.Literal("context_overflow"),
  message: Schema.String,
  responseBody: Schema.String.pipe(Schema.optional),
}).annotate({
  identifier: "Session.Error.Assistant.ContextOverflow",
})

export const AssistantErrorOutputLength = Schema.Struct({
  type: Schema.Literal("output_length"),
}).annotate({
  identifier: "Session.Error.Assistant.OutputLength",
})

export const AssistantErrorStructuredOutput = Schema.Struct({
  type: Schema.Literal("structured_output"),
  message: Schema.String,
  retries: NonNegativeInt,
}).annotate({
  identifier: "Session.Error.Assistant.StructuredOutput",
})

export const AssistantError = Schema.Union([
  AssistantErrorAborted,
  AssistantErrorApi,
  AssistantErrorAuth,
  AssistantErrorContextOverflow,
  AssistantErrorOutputLength,
  AssistantErrorStructuredOutput,
  UnknownError,
]).pipe(Schema.toTaggedUnion("type"))
export type AssistantError = typeof AssistantError.Type

export const AgentSwitched = EventV2.define({
  type: "session.next.agent.switched",
  ...options,
  schema: {
    ...Base,
    agent: Schema.String,
  },
})
export type AgentSwitched = typeof AgentSwitched.Type

export const ModelSwitched = EventV2.define({
  type: "session.next.model.switched",
  ...options,
  schema: {
    ...Base,
    model: ModelV2.Ref,
  },
})
export type ModelSwitched = typeof ModelSwitched.Type

export const Prompted = EventV2.define({
  type: "session.next.prompted",
  ...options,
  schema: {
    ...Base,
    prompt: Prompt,
  },
})
export type Prompted = typeof Prompted.Type

export const Synthetic = EventV2.define({
  type: "session.next.synthetic",
  ...options,
  schema: {
    ...Base,
    text: Schema.String,
  },
})
export type Synthetic = typeof Synthetic.Type

export namespace Shell {
  export const Started = EventV2.define({
    type: "session.next.shell.started",
    ...options,
    schema: {
      ...Base,
      callID: Schema.String,
      command: Schema.String,
    },
  })
  export type Started = typeof Started.Type

  export const Ended = EventV2.define({
    type: "session.next.shell.ended",
    ...options,
    schema: {
      ...Base,
      callID: Schema.String,
      output: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Step {
  export const Started = EventV2.define({
    type: "session.next.step.started",
    ...options,
    schema: {
      ...Base,
      agent: Schema.String,
      model: ModelV2.Ref,
      snapshot: Schema.String.pipe(Schema.optional),
    },
  })
  export type Started = typeof Started.Type

  export const Ended = EventV2.define({
    type: "session.next.step.ended",
    ...options,
    schema: {
      ...Base,
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
      snapshot: Schema.String.pipe(Schema.optional),
    },
  })
  export type Ended = typeof Ended.Type

  export const Failed = EventV2.define({
    type: "session.next.step.failed",
    ...options,
    schema: {
      ...Base,
      error: AssistantError,
    },
  })
  export type Failed = typeof Failed.Type
}

export namespace Text {
  export const Started = EventV2.define({
    type: "session.next.text.started",
    ...options,
    schema: {
      ...Base,
    },
  })
  export type Started = typeof Started.Type

  export const Delta = EventV2.define({
    type: "session.next.text.delta",
    ...options,
    schema: {
      ...Base,
      delta: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = EventV2.define({
    type: "session.next.text.ended",
    ...options,
    schema: {
      ...Base,
      text: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Reasoning {
  export const Started = EventV2.define({
    type: "session.next.reasoning.started",
    ...options,
    schema: {
      ...Base,
      reasoningID: Schema.String,
    },
  })
  export type Started = typeof Started.Type

  export const Delta = EventV2.define({
    type: "session.next.reasoning.delta",
    ...options,
    schema: {
      ...Base,
      reasoningID: Schema.String,
      delta: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = EventV2.define({
    type: "session.next.reasoning.ended",
    ...options,
    schema: {
      ...Base,
      reasoningID: Schema.String,
      text: Schema.String,
    },
  })
  export type Ended = typeof Ended.Type
}

export namespace Tool {
  export namespace Input {
    export const Started = EventV2.define({
      type: "session.next.tool.input.started",
      ...options,
      schema: {
        ...Base,
        callID: Schema.String,
        name: Schema.String,
      },
    })
    export type Started = typeof Started.Type

    export const Delta = EventV2.define({
      type: "session.next.tool.input.delta",
      ...options,
      schema: {
        ...Base,
        callID: Schema.String,
        delta: Schema.String,
      },
    })
    export type Delta = typeof Delta.Type

    export const Ended = EventV2.define({
      type: "session.next.tool.input.ended",
      ...options,
      schema: {
        ...Base,
        callID: Schema.String,
        text: Schema.String,
      },
    })
    export type Ended = typeof Ended.Type
  }

  export const Called = EventV2.define({
    type: "session.next.tool.called",
    ...options,
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
  export type Called = typeof Called.Type

  export const Progress = EventV2.define({
    type: "session.next.tool.progress",
    ...options,
    schema: {
      ...Base,
      callID: Schema.String,
      structured: ToolOutput.Structured,
      content: Schema.Array(ToolOutput.Content),
    },
  })
  export type Progress = typeof Progress.Type

  export const Success = EventV2.define({
    type: "session.next.tool.success",
    ...options,
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
  export type Success = typeof Success.Type

  export const Failed = EventV2.define({
    type: "session.next.tool.failed",
    ...options,
    schema: {
      ...Base,
      callID: Schema.String,
      error: UnknownError,
      provider: Schema.Struct({
        executed: Schema.Boolean,
        metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
      }),
    },
  })
  export type Failed = typeof Failed.Type
}

export const RetryError = Schema.Struct({
  message: Schema.String,
  statusCode: Schema.Finite.pipe(Schema.optional),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  responseBody: Schema.String.pipe(Schema.optional),
  metadata: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
}).annotate({
  identifier: "session.next.retry_error",
})
export type RetryError = typeof RetryError.Type

export const Retried = EventV2.define({
  type: "session.next.retried",
  ...options,
  schema: {
    ...Base,
    attempt: Schema.Finite,
    error: RetryError,
  },
})
export type Retried = typeof Retried.Type

export namespace Compaction {
  export const Started = EventV2.define({
    type: "session.next.compaction.started",
    ...options,
    schema: {
      ...Base,
      reason: Schema.Union([Schema.Literal("auto"), Schema.Literal("manual")]),
    },
  })
  export type Started = typeof Started.Type

  export const Delta = EventV2.define({
    type: "session.next.compaction.delta",
    ...options,
    schema: {
      ...Base,
      text: Schema.String,
    },
  })
  export type Delta = typeof Delta.Type

  export const Ended = EventV2.define({
    type: "session.next.compaction.ended",
    ...options,
    schema: {
      ...Base,
      text: Schema.String,
      include: Schema.String.pipe(Schema.optional),
    },
  })
  export type Ended = typeof Ended.Type
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
export type Event = typeof All.Type
export type Type = Event["type"]

export * as SessionEvent from "./event"
