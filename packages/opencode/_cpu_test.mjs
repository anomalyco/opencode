import { $ } from "bun"

// We need to test the Scheduler's zero-work behavior in isolation
// Run the app in a way that starts the terminal UI but doesn't process AI
// The console command with --help might do this

const proc = Bun.spawn(["bun", "run", "--conditions=browser", "src/index.ts", "console", "--help"], {
  cwd: "C:\\Users\\fauzan\\Desktop\\OPENCODE ULTIMATE\\opencode-EF\\packages\\opencode",
  stdio: ["pipe", "pipe", "pipe"],
})

// Wait for startup
await new Promise(r => setTimeout(r, 2000))

const start = process.cpuUsage()
const wallStart = performance.now()

await new Promise(r => setTimeout(r, 3000))

const elapsed = performance.now() - wallStart
const usage = process.cpuUsage(start)
const totalUs = usage.user + usage.system
const totalMs = totalUs / 1000

console.log(`Elapsed: ${elapsed.toFixed(0)}ms`)
console.log(`CPU (user+system): ${totalUs.toFixed(0)}µs = ${totalMs.toFixed(2)}ms`)
console.log(`CPU percent: ${((totalMs / elapsed) * 100).toFixed(4)}%`)
console.log(`Result: ${totalMs < 50 ? "ZERO-WORK PASS" : "POTENTIAL LEAK"}`)

proc.kill()
