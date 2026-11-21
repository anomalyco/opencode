// Leaves an orphan: this process starts a middle process, which starts a detached grandchild, writes its PID and
// exits. Prints "ready" once the middle process is gone, then exits ("exit") or keeps running ("stay").
const { spawn } = require("node:child_process")

const middle = spawn(
  process.execPath,
  [
    "-e",
    `const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" })
require("node:fs").writeFileSync(${JSON.stringify(process.argv[2])}, String(child.pid))
child.unref()`,
  ],
  { stdio: "ignore" },
)
middle.once("exit", () => {
  process.stdout.write("ready\n")
  if (process.argv[3] === "exit") process.exit(0)
  setInterval(() => {}, 1000)
})
