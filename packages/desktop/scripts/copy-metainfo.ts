import { desktopIdentity } from "../src/shared/identity"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = desktopIdentity.ids[channel]
const productName = desktopIdentity.names[channel]
const summary = "Private Unified Super Intelligence — AI development workspace"

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="io.github.leejaywon">
    <name>leejaywon</name>
  </developer>

  <description>
    <p>
      pusi is an AI development workspace based on OpenCode.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/leejaywon/pusi/issues</url>
  <url type="homepage">https://github.com/leejaywon/pusi</url>
  <url type="vcs-browser">https://github.com/leejaywon/pusi</url>

</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
