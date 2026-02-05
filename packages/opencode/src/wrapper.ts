// OpenCode CWD wrapper - restores real working directory
// bun --cwd overrides process.cwd() for module resolution
// This wrapper restores the original terminal cwd before loading OpenCode
const realCwd = process.env.OPENCODE_REAL_CWD
if (realCwd) {
  Object.defineProperty(process, 'cwd', {
    value: () => realCwd,
    writable: true,
    configurable: true,
  })
}
await import('./index.ts')
