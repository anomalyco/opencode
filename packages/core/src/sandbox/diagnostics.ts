export * as SandboxDiagnostics from "./diagnostics.js"

/** Stderr is untrusted command output: these hints are never used to grant authority or retry. */
export function hint(output: string) {
  if (/dyld\[\d+\]:|Library not loaded:|file system sandbox blocked open\(\)/i.test(output))
    return "Runtime loader failure while sandboxed. Check the executable and its library dependencies; dependencies outside the default runtime roots need experimental.sandbox.readable_roots or full_disk_read in global configuration."
  if (/sandbox-exec:.*(?:sandbox_apply|sandbox_init|syntax error|invalid profile|failed)/i.test(output))
    return "The macOS sandbox could not apply its profile. Check sandbox availability and the server logs; this command was not retried outside the sandbox."
  if (/operation not permitted|permission denied|sandbox.*(?:deny|denied|blocked)/i.test(output))
    return "Permission denial reported while sandboxed. This may be the sandbox or normal account permissions. Inspect any partial effects before requesting a separate approved shell invocation."
}
