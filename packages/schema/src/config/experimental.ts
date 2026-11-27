export * as ConfigExperimental from "./experimental.js"

import { Record, Schema } from "effect"
import { NonNegativeInt, optional } from "../schema.js"
import { ConfigFlag } from "./flag.js"
import { ConfigModel } from "./model.js"
import { ConfigPolicy } from "./policy.js"

export const Sandbox = Schema.Struct({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description: "Enable the shell sandbox on local macOS or Linux. Defaults to false.",
  }),
  full_disk_read: Schema.Boolean.pipe(optional).annotate({
    description: "Allow broad reads with protected-path exclusions.",
  }),
  allow_git_writes: Schema.Boolean.pipe(optional).annotate({
    description: "Allow writes to .git metadata within the workspace. Defaults to false.",
  }),
  linux: Schema.Struct({
    binary: Schema.String.pipe(optional).annotate({
      description: "Absolute path to a custom Bubblewrap executable on Linux. Overrides system discovery.",
    }),
  }).pipe(optional),
  readable_roots: Schema.Array(Schema.String)
    .pipe(optional)
    .annotate({ description: "Additional existing absolute paths shell commands may read." }),
  writable_roots: Schema.Array(Schema.String)
    .pipe(optional)
    .annotate({ description: "Additional existing absolute paths shell commands may write." }),
})

export class Info extends Schema.Class<Info>("ConfigExperimental.Info")({
  sandbox: Sandbox.pipe(optional).annotate({
    description: "Shell sandbox settings are read from global configuration only.",
  }),
  portable_shell_scanner: Schema.Boolean.pipe(optional).annotate({
    description: "Deprecated: the built-in shell permission scanner is now always enabled.",
  }),
  codemode_vm: Schema.Boolean.pipe(optional).annotate({
    description: "Deprecated: ignored because Code Mode always runs on the VM.",
  }),
  all_flags: Schema.Boolean.pipe(optional).annotate({
    description:
      "Enable all flags except opt-in-only flags on any build channel, like OPENCODE_FLAGS=all. Per-flag config settings take precedence over all_flags; false leaves the build defaults in effect.",
  }),
  ...Record.map(ConfigFlag.registry, (description, key) =>
    Schema.Boolean.pipe(optional).annotate({
      description: ConfigFlag.optInOnly.has(key)
        ? description
        : `${description} Defaults to on in local and dev builds and off in releases.`,
    }),
  ),
  // The flag also takes settings; an object turns it on.
  video_generate: Schema.Union([
    Schema.Boolean,
    Schema.Struct({
      model: ConfigModel.Selection.pipe(optional).annotate({
        description:
          "Default model for the experimental_video_generate tool when the agent doesn't choose one, as providerID/modelID. Falls back to automatic selection when it isn't available.",
      }),
    }),
  ])
    .pipe(optional)
    .annotate({
      description: `${ConfigFlag.registry.video_generate} Defaults to on in local and dev builds and off in releases. An object turns it on and sets the tool's options.`,
    }),
  part_rows: Schema.Boolean.pipe(optional).annotate({
    description:
      "Write each assistant part as its own session_part row instead of rewriting the whole message on every event. Defaults to true; set false to fall back to whole-message writes.",
  }),
  image_generate: Schema.Union([
    Schema.Boolean,
    Schema.Struct({
      model: ConfigModel.Selection.pipe(optional).annotate({
        description:
          "Default model for the experimental_image_generate tool when the agent doesn't choose one, as providerID/modelID. Falls back to automatic selection when it isn't available.",
      }),
    }),
  ])
    .pipe(optional)
    .annotate({
      description:
        "Settings for the experimental_image_generate tool, which is offered while a connected provider has an image model.",
    }),
  subagent_depth: NonNegativeInt.pipe(optional).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1.",
  }),
  location_idle_timeout: Schema.Union([Schema.DurationFromString, Schema.Literal(false)])
    .pipe(optional)
    .annotate({
      description:
        'How long a location can go without session activity before its services are unloaded. Running sessions and background jobs keep a location loaded. Set to false to never unload (default: "60 minutes")',
    }),
  policies: ConfigPolicy.Info.pipe(Schema.Array, optional).annotate({
    description: "Deprecated: use top-level policies. Ordered policies controlling access to configured resources",
  }),
}) {}
