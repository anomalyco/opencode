import { Option, Schema } from "effect"

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/**
 * Code Mode's `execute` output for display. The tool returns its result (compact JSON for structured values) followed
 * by optional "Warnings:" and "Logs:" sections. A JSON result comes back indented as `json`, the sections as `rest`,
 * and `text` joins them.
 */
export function formatExecuteOutput(output: string) {
  const end = output.search(/\n\n(Warnings|Logs):\n/)
  const result = end === -1 ? output : output.slice(0, end)
  const rest = end === -1 ? undefined : output.slice(end).trim()
  const json = indentedJson(result)
  return { json, rest, text: rest === undefined ? (json ?? result) : `${json ?? result}\n\n${rest}` }
}

function indentedJson(text: string) {
  if (!text.startsWith("{") && !text.startsWith("[")) return
  const decoded = decodeJson(text)
  if (Option.isNone(decoded)) return
  return JSON.stringify(decoded.value, null, 2)
}
