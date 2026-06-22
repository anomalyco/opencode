import type { Agent } from "./agent.js"
import type { AISDK } from "./aisdk.js"
import type { Catalog } from "./catalog.js"
import type { Command } from "./command.js"
import type { Event } from "./event.js"
import type { FileSystem } from "./filesystem.js"
import type { Integration } from "./integration.js"
import type { Location } from "./location.js"
import type { Npm } from "./npm.js"
import type { Path } from "./path.js"
import type { Reference } from "./reference.js"
import type { Skill } from "./skill.js"

export interface PluginHost {
  readonly agent: Agent
  readonly aisdk: AISDK
  readonly catalog: Catalog
  readonly command: Command
  readonly event: Event
  readonly filesystem: FileSystem
  readonly integration: Integration
  readonly location: Location
  readonly npm: Npm
  readonly path: Path
  readonly reference: Reference
  readonly skill: Skill
}
