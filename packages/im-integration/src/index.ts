import { createOpencodeClient } from "@opencode-ai/sdk"
import { IMManager } from "./manager"

export async function createOpencode(config?: any) {
  const client = createOpencodeClient({
    baseUrl: config?.port ? `http://localhost:${config.port}` : "http://localhost:4100",
  })
  return client
}

export { IMManager }
