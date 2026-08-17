import fs from "fs/promises"
import os from "os"
import path from "path"

const CHUNK_SIZE = 256 * 1024
const VSCODE_CHUNK_SIZE = 64 * 1024
const TREE_BASE = 6
const OFFSET = 2_000_000
const LIMIT = 125
const LINES = OFFSET + LIMIT + 125

const args = process.argv.slice(2)
const iterationsIndex = args.indexOf("--iterations")
const iterations = iterationsIndex === -1 ? 1 : Number(args[iterationsIndex + 1])

if (!Number.isInteger(iterations) || iterations < 1) {
  console.error("--iterations must be a positive integer")
  process.exit(1)
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-large-read-"))
const file = path.join(directory, "opencode.log")
const output = await fs.open(file, "w")

for (let start = 1; start <= LINES; start += 10_000) {
  const count = Math.min(10_000, LINES - start + 1)
  const text = Array.from(
    { length: count },
    (_, index) =>
      `${String(start + index).padStart(7, "0")} Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n`,
  ).join("")
  await output.write(text)
}
await output.close()

const expected = Array.from(
  { length: LIMIT },
  (_, index) => `${String(OFFSET + index).padStart(7, "0")} Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
).join("\n")

const readChunk = async (handle: fs.FileHandle, position: number, length: number) => {
  const buffer = Buffer.allocUnsafe(length)
  const result = await handle.read(buffer, 0, length, position)
  return buffer.subarray(0, result.bytesRead)
}

// Mirrors ReadToolFileSystem today: append 256 KiB, concatenate every chunk,
// then decode and split the complete accumulated prefix again.
const current = async () => {
  const handle = await fs.open(file, "r")
  const info = await handle.stat()
  const chunks: Buffer[] = []

  while (true) {
    const position = chunks.reduce((total, chunk) => total + chunk.length, 0)
    const chunk = await readChunk(handle, position, CHUNK_SIZE)
    chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    const eof = bytes.length >= info.size
    const split = new TextDecoder().decode(bytes).split("\n")
    const complete = eof ? (split.at(-1) === "" ? split.slice(0, -1) : split) : split.slice(0, -1)
    const available = complete.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    const entries = available.slice(OFFSET - 1, OFFSET - 1 + LIMIT)
    if (entries.length === LIMIT || eof) {
      await handle.close()
      return entries.join("\n")
    }
  }
}

type Summary = { readonly bytes: number; readonly lines: number }
type ZedNode =
  | { readonly type: "leaf"; readonly data: Buffer; readonly summary: Summary }
  | { readonly type: "branch"; readonly children: ReadonlyArray<ZedNode>; readonly summary: Summary }

const summary = (nodes: ReadonlyArray<ZedNode>) => ({
  bytes: nodes.reduce((total, node) => total + node.summary.bytes, 0),
  lines: nodes.reduce((total, node) => total + node.summary.lines, 0),
})

// Request-local adaptation of Zed's Rope<SumTree<Chunk>>. Leaves summarize
// bytes/newlines and a B+-style tree seeks by accumulated newline count.
// https://github.com/zed-industries/zed/blob/8968bf78084f30809aa2ce1574a3be68ed02a513/crates/rope/src/rope.rs
const zed = async () => {
  const handle = await fs.open(file, "r")
  const leaves: Array<Extract<ZedNode, { readonly type: "leaf" }>> = []

  for (let position = 0; ; position += CHUNK_SIZE) {
    const data = await readChunk(handle, position, CHUNK_SIZE)
    if (data.length === 0) break
    let lines = 0
    for (const byte of data) if (byte === 10) lines++
    leaves.push({ type: "leaf", data, summary: { bytes: data.length, lines } })
  }

  const build = (nodes: ReadonlyArray<ZedNode>): ZedNode => {
    if (nodes.length === 1) return nodes[0]
    const parents = Array.from({ length: Math.ceil(nodes.length / (TREE_BASE * 2)) }, (_, index) => {
      const children = nodes.slice(index * TREE_BASE * 2, (index + 1) * TREE_BASE * 2)
      return { type: "branch" as const, children, summary: summary(children) }
    })
    return build(parents)
  }

  const root = build(leaves)
  const byteOffset = (newline: number) => {
    if (newline === 0) return 0
    let node = root
    let remaining = newline
    let offset = 0
    while (node.type === "branch") {
      const child = node.children.find((candidate) => {
        if (remaining <= candidate.summary.lines) return true
        remaining -= candidate.summary.lines
        offset += candidate.summary.bytes
        return false
      })
      if (!child) return root.summary.bytes
      node = child
    }
    for (const [index, byte] of node.data.entries()) {
      if (byte !== 10) continue
      remaining--
      if (remaining === 0) return offset + index + 1
    }
    return root.summary.bytes
  }

  const start = byteOffset(OFFSET - 1)
  const end = byteOffset(OFFSET + LIMIT - 1)
  let position = 0
  const selected = leaves.flatMap((leaf) => {
    const leafStart = position
    position += leaf.data.length
    if (position <= start || leafStart >= end) return []
    return [leaf.data.subarray(Math.max(0, start - leafStart), Math.min(leaf.data.length, end - leafStart))]
  })
  await handle.close()
  return new TextDecoder().decode(Buffer.concat(selected)).replace(/\n$/, "")
}

type Piece = { readonly data: Buffer; readonly lineStarts: Uint32Array }
type PieceNode = {
  readonly piece: Piece
  readonly left?: PieceNode
  readonly right?: PieceNode
  readonly bytes: number
  readonly lines: number
}

// Request-local adaptation of VS Code's piece tree. Each piece owns compact
// line starts while tree nodes summarize bytes and line feeds to their left.
// https://github.com/microsoft/vscode/blob/03459a7e73daf894cc2cdd282d41b09d1517cb68/src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase.ts
const vscode = async () => {
  const handle = await fs.open(file, "r")
  const pieces: Piece[] = []

  for (let position = 0; ; position += VSCODE_CHUNK_SIZE) {
    const data = await readChunk(handle, position, VSCODE_CHUNK_SIZE)
    if (data.length === 0) break
    const starts: number[] = []
    for (const [index, byte] of data.entries()) if (byte === 10) starts.push(index + 1)
    pieces.push({ data, lineStarts: Uint32Array.from(starts) })
  }

  const build = (start: number, end: number): PieceNode | undefined => {
    if (start >= end) return
    const middle = Math.floor((start + end) / 2)
    const left = build(start, middle)
    const right = build(middle + 1, end)
    return {
      piece: pieces[middle],
      left,
      right,
      bytes: (left?.bytes ?? 0) + pieces[middle].data.length + (right?.bytes ?? 0),
      lines: (left?.lines ?? 0) + pieces[middle].lineStarts.length + (right?.lines ?? 0),
    }
  }

  const root = build(0, pieces.length)
  if (!root) throw new Error("fixture is empty")
  const byteOffset = (newline: number) => {
    if (newline === 0) return 0
    let node: PieceNode | undefined = root
    let remaining = newline
    let offset = 0
    while (node) {
      const leftLines = node.left?.lines ?? 0
      const leftBytes = node.left?.bytes ?? 0
      if (remaining <= leftLines) {
        node = node.left
        continue
      }
      remaining -= leftLines
      offset += leftBytes
      if (remaining <= node.piece.lineStarts.length) return offset + node.piece.lineStarts[remaining - 1]
      remaining -= node.piece.lineStarts.length
      offset += node.piece.data.length
      node = node.right
    }
    return root.bytes
  }

  const start = byteOffset(OFFSET - 1)
  const end = byteOffset(OFFSET + LIMIT - 1)
  let position = 0
  const selected = pieces.flatMap((piece) => {
    const pieceStart = position
    position += piece.data.length
    if (position <= start || pieceStart >= end) return []
    return [piece.data.subarray(Math.max(0, start - pieceStart), Math.min(piece.data.length, end - pieceStart))]
  })
  await handle.close()
  return new TextDecoder().decode(Buffer.concat(selected)).replace(/\n$/, "")
}

const algorithms = [
  { name: "current", run: current },
  { name: "zed-sum-tree", run: zed },
  { name: "vscode-piece-tree", run: vscode },
]
const samples = new Map(algorithms.map((algorithm) => [algorithm.name, [] as number[]]))

console.log(`Fixture: ${(await fs.stat(file)).size.toLocaleString()} bytes, ${LINES.toLocaleString()} lines`)
console.log(`Read: offset ${OFFSET.toLocaleString()}, limit ${LIMIT}; indexes rebuilt for every sample`)

for (let iteration = 0; iteration < iterations; iteration++) {
  for (const algorithm of algorithms) {
    const start = performance.now()
    const result = await algorithm.run()
    const elapsed = performance.now() - start
    if (result !== expected) throw new Error(`${algorithm.name} returned the wrong page`)
    samples.get(algorithm.name)?.push(elapsed)
    console.log(`${algorithm.name.padEnd(19)} ${(elapsed / 1_000).toFixed(3)} s`)
  }
}

if (iterations > 1) {
  console.log("\nMean")
  for (const algorithm of algorithms) {
    const values = samples.get(algorithm.name) ?? []
    const mean = values.reduce((total, value) => total + value, 0) / values.length
    console.log(`${algorithm.name.padEnd(19)} ${(mean / 1_000).toFixed(3)} s`)
  }
}

await fs.rm(directory, { recursive: true, force: true })
