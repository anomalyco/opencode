import { createRequire } from "node:module"

declare const OPENCODE_LIBC: string | undefined

const require = createRequire(import.meta.url)

export default function load() {
  const libc = typeof OPENCODE_LIBC === "undefined" ? undefined : OPENCODE_LIBC
  return require(
    process.env.OPENCODE_PARCEL_WATCHER_PATH ??
      `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${libc || "glibc"}` : ""}`,
  )
}
