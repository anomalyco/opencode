// Published from packages/process-daemon under its original npm scope.
import { binaryPath } from "@opencode-ai/pty"

const binding: string | { readonly path: string; readonly version: string; readonly sha256: string } | undefined =
  binaryPath

export default binding
