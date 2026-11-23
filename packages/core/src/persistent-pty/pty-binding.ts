import { binaryPath } from "@opencode/pty"

const binding: string | { readonly path: string; readonly version: string; readonly sha256: string } | undefined =
  binaryPath

export default binding
