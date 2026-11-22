import { createRequire } from "node:module"

declare const OPENCODE_LIBC: string | undefined

// Lazy: on workerd import.meta.url is undefined and the watcher is never
// loaded, so createRequire must not run at module scope.
export default function load() {
  const require = createRequire(import.meta.url)
  const libc = typeof OPENCODE_LIBC === "undefined" ? undefined : OPENCODE_LIBC
  if (process.env.OPENCODE_PARCEL_WATCHER_PATH) return require(process.env.OPENCODE_PARCEL_WATCHER_PATH)
  // FreeBSD has an official @parcel/watcher binding (kqueue). Use a static
  // specifier so `bun build --compile` embeds it. There is no aarch64 package
  // yet, so arm64 keeps falling through to the dynamic lookup below.
  if (process.platform === "freebsd" && process.arch === "x64") {
    return require("@parcel/watcher-freebsd-x64")
  }
  return require(
    `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${libc || "glibc"}` : ""}`,
  )
}
