import { IMManager } from "./manager"

export async function createOpencode(config?: any) {
  const { createOpencode } = await import("@opencode-ai/sdk")
  return createOpencode(config || { port: 4096 })
}

export { IMManager }
