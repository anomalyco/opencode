import { hashID } from "./identity"

export type SentenceSegment = {
  id: string
  index: number
  text: string
}

const namespace = "feishu-sentence:v1"
const terminal = new Set(["。", "！", "？", "!", "?", "；", ";"])

export async function splitMessage(messageID: string, text: string): Promise<readonly SentenceSegment[]> {
  const values = segment(text)
  return Promise.all(
    values.map(async (value, index) => ({
      id: await hashID(namespace, "sentence_", `${messageID}\0${index}\0${value}`),
      index,
      text: value,
    })),
  )
}

function segment(text: string) {
  if (!text) return [text]

  const values: string[] = []
  let current = ""

  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    current += character

    if (character === "\r" && text[index + 1] === "\n") {
      current += "\n"
      index++
      values.push(current)
      current = ""
      continue
    }
    if (character === "\n") {
      values.push(current)
      current = ""
      continue
    }
    if (!terminal.has(character)) continue
    if (terminal.has(text[index + 1] ?? "") || text[index + 1] === "\r" || text[index + 1] === "\n") continue
    values.push(current)
    current = ""
  }

  if (current) values.push(current)
  return values
}
