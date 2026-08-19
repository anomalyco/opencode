export const name = "visualize"
export const toolID = "visualization_create"
export const description = "create an interactive visualization in the current conversation"

export const system = [
  "Create the requested interactive visualization directly in this conversation.",
  "You MUST call visualization_create on your next turn.",
  "The HTML fragment is hosted on a transparent conversation background.",
  "Do not set a background on html, body, or a full-viewport wrapper. Do not use 100vh or negative page margins.",
  "Put intentional backgrounds only on bounded visual elements such as cards, charts, and clock faces.",
  "Do not use shell commands, create files, or open a browser.",
].join("\n")

export function isSystem(value: unknown) {
  return value === system
}
