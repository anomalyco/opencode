import type { OpencodeClient } from "@opencode-ai/sdk"
import type { Bus } from "../bus/index.js"
import type { Integration, IntegrationFactory, IntegrationConfig } from "./types.js"

export class IntegrationManager {
  private integrations: Integration[] = []

  constructor(
    private readonly client: OpencodeClient,
    private readonly bus: Bus.Interface,
  ) {}

  register(factory: IntegrationFactory, config: IntegrationConfig): void {
    if (!config.enabled) return
    this.integrations.push(factory(config))
  }

  async startAll(): Promise<void> {
    for (const integration of this.integrations) {
      try {
        await integration.start(this.client, this.bus)
        console.log(`✅ Integration started: ${integration.name}`)
      } catch (error) {
        console.error(`❌ Integration failed to start: ${integration.name}`, error)
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const integration of this.integrations) {
      try {
        await integration.stop()
        console.log(`🛑 Integration stopped: ${integration.name}`)
      } catch (error) {
        console.error(`❌ Integration failed to stop: ${integration.name}`, error)
      }
    }
  }
}
