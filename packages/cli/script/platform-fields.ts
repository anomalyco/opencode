// npm only consults `libc` on Linux, so declaring it elsewhere is noise. On Linux an
// omitted `libc` matches both glibc and musl packages, which makes npm install every
// variant of the platform package; declaring it selects the one that runs here.
export function platformFields(target: { os: string; arch: string; abi?: "musl" }) {
  return {
    os: [target.os],
    cpu: [target.arch],
    ...(target.os === "linux" ? { libc: [target.abi ?? "glibc"] } : {}),
  }
}
