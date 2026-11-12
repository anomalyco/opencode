export * as ConfigSandbox from "./sandbox.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export const Mode = Schema.Literals(["read-only", "workspace-write"]).annotate({ identifier: "Config.Sandbox.Mode" })
export type Mode = typeof Mode.Type

export const Network = Schema.Literals(["deny", "allow"]).annotate({ identifier: "Config.Sandbox.Network" })
export type Network = typeof Network.Type

export const Roots = Schema.Array(Schema.String)

export class Info extends Schema.Class<Info>("Config.Sandbox")({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description:
      "Run agent shell commands inside an OS-level sandbox (bubblewrap on Linux, sandbox-exec on macOS). Fails closed when the backend is unavailable (default: false)",
  }),
  mode: Mode.pipe(optional).annotate({
    description:
      'Filesystem access inside the sandbox: "read-only" mounts everything read-only, "workspace-write" also allows writes to the workspace and temporary directories (default: "workspace-write")',
  }),
  network: Network.pipe(optional).annotate({
    description: 'Network access inside the sandbox: "deny" blocks it, "allow" permits it (default: "deny")',
  }),
  writable_roots: Roots.pipe(optional).annotate({
    description:
      'Extra directories a "workspace-write" sandbox may write to, besides the workspace. Relative paths resolve against the workspace. Layers add to each other',
  }),
  readable_roots: Roots.pipe(optional).annotate({
    description:
      "Extra directories mounted read-only inside the sandbox, such as paths the host root does not expose. Relative paths resolve against the workspace. Layers add to each other",
  }),
}) {}
