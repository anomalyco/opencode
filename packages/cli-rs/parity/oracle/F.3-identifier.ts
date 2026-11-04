// P-ORACLE for crates/api/src/id.rs: the time prefix TypeScript's Identifier.create mints for a fixed call
// sequence, counter restarts and overflow past 0xfff included. Each case calls create `repeat` times and
// records the last prefix. Writes parity/fixtures/F.3/identifier.json.
import { Identifier } from "../../../schema/src/identifier"

const sequence = [
  { descending: false, timestamp: 1_717_171_717_000, repeat: 1 },
  { descending: false, timestamp: 1_717_171_717_000, repeat: 1 },
  { descending: true, timestamp: 1_717_171_717_000, repeat: 1 },
  { descending: true, timestamp: 1_717_171_717_001, repeat: 1 },
  { descending: false, timestamp: 1_717_171_717_000, repeat: 1 },
  { descending: false, timestamp: 0, repeat: 1 },
  { descending: true, timestamp: 0, repeat: 1 },
  { descending: false, timestamp: 1_800_000_000_123, repeat: 4_096 },
  { descending: false, timestamp: 1_800_000_000_123, repeat: 1 },
  { descending: true, timestamp: 1_800_000_000_123, repeat: 3 },
  { descending: false, timestamp: 68_719_476_735, repeat: 1 },
]

const cases = sequence.map((item) => {
  const ids = Array.from({ length: item.repeat }, () => Identifier.create(item.descending, item.timestamp))
  return { ...item, prefix: ids.at(-1)!.slice(0, 12) }
})

const file = new URL("../fixtures/F.3/identifier.json", import.meta.url).pathname
await Bun.write(file, JSON.stringify(cases, null, 2) + "\n")
console.log(`identifier: ${cases.length} cases`)
