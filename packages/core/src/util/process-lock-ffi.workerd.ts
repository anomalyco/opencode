export type LockResult =
  | { readonly acquired: true }
  | { readonly acquired: false; readonly held: true }
  | { readonly acquired: false; readonly held: false; readonly code: number }

// workerd has no FFI and no cross-process file locking; a Durable Object is
// already single-threaded per instance, so nothing on this runtime should
// reach these.
export function lockDarwin(): LockResult {
  throw new Error("Process locks are unavailable on the workerd runtime")
}

export function lockLinux(): LockResult {
  throw new Error("Process locks are unavailable on the workerd runtime")
}
