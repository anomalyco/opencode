// npm selects a platform package by matching `os`, `cpu` and `libc`. A Linux package that omits `libc` matches both
// glibc and musl, so every variant of it is installed wherever a Linux host installs any of them, even though only one
// of them can run. `libc` is only consulted on Linux, so no other platform declares it.
export function platformFields(target: { os: string; arch: string; abi?: "musl" }) {
  return {
    os: [target.os],
    cpu: [target.arch],
    ...(target.os === "linux" ? { libc: [target.abi ?? "glibc"] } : {}),
  }
}
