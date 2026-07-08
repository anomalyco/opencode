// OpenWork — knowledge-work layer that lives on top of opencode's core without
// modifying SessionV2 or the system prompt vendor dispatch. Everything here is
// opt-in and consumed via `@opencode-ai/core/work`.

export { Scaffold } from "./scaffold"
export type { WorkFolder } from "./scaffold"
export { LAYOUT } from "./scaffold"

export * as Instructions from "./instructions"