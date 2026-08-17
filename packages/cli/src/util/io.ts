import { text } from "node:stream/consumers"

export function readStdin() {
  return text(process.stdin)
}
