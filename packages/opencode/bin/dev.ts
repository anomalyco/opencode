// Dev-only launcher: chdir to the caller's project (passed as $1) before
// loading the real entrypoint, so process.cwd() matches the built binary.
const originalPwd = process.argv[2]
if (originalPwd) {
  process.chdir(originalPwd)
  process.argv.splice(2, 1)
}
await import("../src/index")
