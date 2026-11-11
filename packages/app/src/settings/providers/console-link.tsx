import { Icon } from "@opencode/ui/icon"
import type { SkillInfo } from "@opencode/client/promise"
import { createEffect, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { createExtensionLoad } from "@/settings/extension-load"
import { consoleMcpLinks, consoleMcps, consoleSkillLink, consoleWorkspace } from "./console-extensions"
import "@/settings/settings.css"

/**
 * Which MCP servers and skills OpenCode Console delivers, read from config and the Console sign-in, for the Extensions
 * pages. `directory` is the Location whose config decides which same-named server wins; without one, the server's.
 */
export function createConsoleSources(directory: () => string | undefined) {
  const serverSdk = useServerSDK()
  const data = useData()

  const location = () => {
    const target = directory()

    return target ? { directory: target } : data.location.default()
  }

  const sources = createExtensionLoad({
    key: () => `${serverSdk.scope}\0${directory() ?? ""}`,
    task: async (_, signal) => {
      const target = directory()

      const [entries, active] = await Promise.all([
        serverSdk.api.config.get(undefined, { signal }),
        target ? serverSdk.api.config.get({ location: { directory: target } }, { signal }) : undefined,
      ])

      return consoleMcps(entries, active ?? entries)
    },
  })

  onCleanup(serverSdk.event.on("config.updated", () => sources.invalidate()))

  createEffect(() => {
    if (serverSdk.connection.status() !== "connected") return
    void data.location.integration.sync(location()).catch(() => undefined)
  })

  const signedIn = () =>
    !!data.location.integration
      .list(location())
      ?.find((integration) => integration.id === "opencode")
      ?.connections.some((connection) => connection.type === "credential")

  const mcps = () => {
    const current = sources.view()

    return current.status === "ready" ? current.value : []
  }

  const mcp = (name: string) => mcps().find((entry) => entry.name === name)

  // A same-named server in the user's config replaces Console's, so only the link stays Console's.
  const managed = (name: string) => {
    const current = mcp(name)

    return current && !current.overridden ? current : undefined
  }

  const links = (name: string) => {
    const current = mcp(name)

    return current && consoleMcpLinks(current)
  }

  return {
    view: sources.view,
    retry: sources.retry,
    mcp,
    managed,
    links,
    // A Console server whose account isn't connected lists tools but can't run them, so it asks for the connection in
    // the switch's place, as a server that needs a sign-in does.
    connect: (name: string) => (managed(name)?.needsConnection ? links(name)?.connect : undefined),
    skill: (skill: Pick<SkillInfo, "id" | "path">) => consoleSkillLink(skill, consoleWorkspace(mcps()), signedIn()),
  }
}

/** An extension's name that opens where Console manages it. */
export function ConsoleName(props: { name: string; href: string; class?: string }) {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <button
      type="button"
      class="settings-console-name"
      aria-label={language.t("settings.extensions.console.manage", { name: props.name })}
      onClick={() => platform.openExternal(props.href)}
    >
      <span class={`settings-extension-name truncate ${props.class ?? ""}`}>{props.name}</span>
      <Icon name="arrow-up-right" />
    </button>
  )
}

/** After a server the user's config replaces Console's with, a link to Console's. */
export function ConsoleReplaced(props: { name: string; href: string }) {
  const language = useLanguage()
  const platform = usePlatform()

  return (
    <button
      type="button"
      class="settings-mcp-source"
      aria-label={language.t("settings.extensions.console.manage", { name: props.name })}
      onClick={() => platform.openExternal(props.href)}
    >
      <span class="truncate">{language.t("settings.extensions.console.replaced")}</span>
      <Icon name="arrow-up-right" />
    </button>
  )
}
