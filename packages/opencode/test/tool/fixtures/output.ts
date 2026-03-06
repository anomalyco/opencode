const mode = Bun.argv[2]
const n = Number(Bun.argv[3])

if (mode === "lines") {
  console.log(Array.from({ length: n }, (_, i) => i + 1).join("\n"))
  process.exit(0)
}

if (mode === "bytes") {
  process.stdout.write("a".repeat(n))
  process.exit(0)
}

throw new Error(`unknown mode: ${mode}`)
