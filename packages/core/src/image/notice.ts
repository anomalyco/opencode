export * as ImageNotice from "./notice.js"

/**
 * The completion notice for a background image job, shaped like `<shell id=…>` and `<subagent sessionID=…>` notices
 * so an agent can tell which request finished when several are running.
 */
export function text(input: { id: string; state: string; prompt?: string; body: string }) {
  const prompt = input.prompt === undefined ? "" : ` prompt="${label(input.prompt)}"`
  return `<image id="${input.id}" state="${input.state}"${prompt}>\n${input.body}\n</image>`
}

function label(prompt: string) {
  const flat = prompt.replace(/\s+/g, " ").replaceAll('"', "'").trim()
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}
