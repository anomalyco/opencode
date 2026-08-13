const revision = process.argv[2] ?? "HEAD"
const opencode = process.argv[3] ?? new URL("../../../../", import.meta.url).pathname
const startedAt = performance.now()
const child = Bun.spawn(
  [
    process.execPath,
    "./scripts/capture-opencode-drive.ts",
    "--opencode",
    opencode,
    "--revision",
    revision,
    "--theme",
    "opencode",
    "--theme",
    "tokyonight",
    "--theme",
    "everforest",
    "--jobs",
    "3",
  ],
  { cwd: import.meta.dir + "/..", stdout: "inherit", stderr: "inherit" },
)

if ((await child.exited) !== 0) throw new Error("Capture matrix benchmark failed")
console.log(`METRIC capture_matrix_total_ms=${Math.round(performance.now() - startedAt)}`)
