import { Schema } from "effect"
import { Ipc } from "../sdk"

export const SshConfig = Schema.Struct({ id: Schema.String, target: Schema.String, name: Schema.String })

export type SshConfig = typeof SshConfig.Type

export const SshHttp = Schema.Struct({ url: Schema.String, password: Schema.String })

export type SshHttp = typeof SshHttp.Type

export const SshStage = Schema.Literals([
  "disconnected",
  "connecting",
  "checking",
  "downloading",
  "uploading",
  "starting",
  "ready",
  "authentication",
  "incompatible",
  "failed",
])

export const SshPrompt = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  confirm: Schema.Boolean,
})

export const SshItem = Schema.Struct({
  config: SshConfig,
  saved: Schema.Boolean,
  destination: Schema.optional(Schema.String),
  stage: SshStage,
  http: Schema.optional(SshHttp),
  prompt: Schema.optional(SshPrompt),
  authenticatingElsewhere: Schema.optional(Schema.Boolean),
  detail: Schema.String,
  error: Schema.optional(
    Schema.Literals([
      "connection",
      "input",
      "platform",
      "version",
      "install",
      "service",
      "host-key",
      "ssh-missing",
      "unpublished",
    ]),
  ),
})

export type SshItem = typeof SshItem.Type

/** `revision` grows with every push, so a caller can wait for the state that follows its request. */
export const SshState = Schema.Struct({ servers: Schema.Array(SshItem), revision: Schema.Number })

export type SshState = typeof SshState.Type

export const SshStart = Schema.Struct({
  id: Schema.String,
  target: Schema.String,
  name: Schema.String,
  replace: Schema.optional(Schema.Boolean),
  background: Schema.optional(Schema.Boolean),
})

export type SshStart = typeof SshStart.Type

const Id = Schema.Struct({ id: Schema.String })

/** SSH connections, owned by the main process. Prompts reach only the window that started the attempt. */
export const Ssh = Ipc.define({
  id: "ssh",
  state: SshState,
  methods: {
    /** Resolves with the state revision that includes the admitted attempt. */
    start: { input: SshStart, output: Schema.Number },
    resolve: { input: Id, output: Schema.NullOr(SshHttp) },
    respond: { input: Schema.Struct({ id: Schema.String, prompt: Schema.String, value: Schema.String }) },
    cancel: { input: Id },
    forget: { input: Id },
  },
})
