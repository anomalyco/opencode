if (process.env.OPENCODE_REAL_CWD) {
  process.chdir(process.env.OPENCODE_REAL_CWD)
  process.env.PWD = process.env.OPENCODE_REAL_CWD
  delete process.env.OPENCODE_REAL_CWD
}
await import("./index.ts")
