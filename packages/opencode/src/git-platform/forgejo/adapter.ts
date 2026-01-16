import { GiteaAdapter } from "../gitea/adapter"
import type { Platform, PlatformConfig } from "../types"

export class ForgejoAdapter extends GiteaAdapter {
  override readonly platform: Platform = "forgejo"

  constructor(config: PlatformConfig) {
    super(config)

    if (this.baseUrl.includes("codeberg.org")) {
      this.setRateLimit({ requestsPerMinute: 30, retryDelay: 2000, maxRetries: 5 })
    }
  }
}
