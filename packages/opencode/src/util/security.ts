// Blocks same-UID ptrace of this process on Linux.
// Prevents a prompt-injected `gdb -p $PPID` from scraping
// API keys or tokens from the heap. No-op on non-Linux.
export function setNonDumpable() {
  if (process.platform !== "linux" || typeof Bun === "undefined") return
  try {
    const ffi = require("bun:ffi") as typeof import("bun:ffi")
    const lib = ffi.dlopen("libc.so.6", {
      prctl: {
        args: ["int", "u64", "u64", "u64", "u64"],
        returns: "int",
      },
    } as const)
    const PR_SET_DUMPABLE = 4
    lib.symbols.prctl(PR_SET_DUMPABLE, 0n, 0n, 0n, 0n)
  } catch {}
}
