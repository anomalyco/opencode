export * as ConfigSandbox from "./sandbox.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.Sandbox")({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description: "Run agent shell commands inside an OS-level sandbox (default: false)",
  }),
  mode: Schema.Literals(["read-only", "workspace-write"]).pipe(optional).annotate({
    description:
      "Filesystem policy when the sandbox is enabled. read-only denies every write, workspace-write allows writes to the workspace and the system temp directory. Defaults to read-only, the strictest mode",
  }),
  network: Schema.Literals(["deny", "allow"]).pipe(optional).annotate({
    description: "Network policy when the sandbox is enabled (default: deny)",
  }),
  writable_roots: Schema.String.pipe(Schema.Array, optional).annotate({
    description:
      "Extra writable directories when the sandbox runs in workspace-write mode, absolute or relative to the workspace. Honored from user-level config only; a repository cannot add writable roots outside itself",
  }),
}) {}
