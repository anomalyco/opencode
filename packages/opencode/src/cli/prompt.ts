import * as prompts from "@clack/prompts"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

export const createSpinner = () => prompts.spinner({ frames: [...SPINNER_FRAMES] })
