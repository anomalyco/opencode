const revision = process.argv[2] ?? "2a0ccdbfd4589ba2181624f25c55ed4ac0546b2d"
const opencode = process.argv[3] ?? "/Users/kit/code/open-source/opencode"
const startedAt = performance.now()
const child = Bun.spawn([
  process.execPath,
  "./scripts/capture-opencode-drive.ts",
  "--opencode", opencode,
  "--revision", revision,
  "--theme", "opencode",
  "--theme", "tokyonight",
  "--theme", "everforest",
  "--jobs", "3",
], { cwd: import.meta.dir + "/..", stdout: "inherit", stderr: "inherit" })

if (await child.exited !== 0) throw new Error("Capture matrix benchmark failed")
console.log(`METRIC capture_matrix_total_ms=${Math.round(performance.now() - startedAt)}`)
