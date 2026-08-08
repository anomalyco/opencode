import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "ai.jarvis.desktop" : `ai.jarvis.desktop.${channel}`
const productName = channel === "prod" ? "Jarvis" : `Jarvis ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `AI-powered development tool${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="ai.jarvis">
    <name>Jarvis</name>
  </developer>

  <description>
    <p>
      Jarvis is an AI-powered development tool that helps you write and run code with any AI model.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <!-- TODO(jarvis): apuntar a https://github.com/jaminsmoke/Jarvis cuando haya docs propias -->
  <url type="bugtracker">https://github.com/anomalyco/jarvis/issues</url>
  <!-- TODO(jarvis): homepage real cuando exista web propia (jarvis.ai es placeholder) -->
  <url type="homepage">https://jarvis.ai</url>
  <!-- TODO(jarvis): apuntar a https://github.com/jaminsmoke/Jarvis -->
  <url type="vcs-browser">https://github.com/anomalyco/jarvis</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
