import { resolveChannel } from "./utils"

const arg = process.argv[2]

const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "com.manostech.editor" : `com.manostech.editor.${channel}`

const productName = channel === "prod" ? "Editor IA ManosTech" : `Editor IA ManosTech ${channel.charAt(0).toUpperCase() + channel.slice(1)}`

const summary = `Editor de código com IA${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="com.manostech">
    <name>ManosTech</name>
  </developer>

  <description>
    <p>
      O Editor IA ManosTech é um editor com agente de IA que ajuda a escrever e executar código com qualquer modelo de IA.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/BielJuv/opencode/issues</url>
  <url type="homepage">https://manostech-system.com.br</url>
  <url type="vcs-browser">https://github.com/BielJuv/opencode</url>

</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)

console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
