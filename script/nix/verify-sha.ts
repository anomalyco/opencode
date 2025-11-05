const argv = Bun.argv.slice(2)
if (argv.length < 2) {
  console.error("usage: verify-sha <file> <sha512>")
  process.exit(1)
}

const file = argv[0]
const raw = argv[1]
const want = raw.startsWith("sha512-") ? raw.slice(7) : raw

const data = await Bun.file(file).arrayBuffer()
const sha = new Bun.SHA512()
sha.update(data)
const digest = sha.digest("base64")

if (digest !== want) {
  console.error(`hash mismatch: expected ${want}, got ${digest}`)
  process.exit(1)
}
