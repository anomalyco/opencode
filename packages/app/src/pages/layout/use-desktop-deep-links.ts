import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLayout } from "@/context/layout"
import { ServerConnection, useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { collectNewSessionDeepLinks, collectOpenProjectDeepLinks } from "./deep-links"
import { useDeepLinkListener } from "./use-deep-link-listener"

export function useDesktopDeepLinks() {
  const layout = useLayout()
  const navigate = useNavigate()
  const server = useServer()
  const tabs = useTabs()

  useDeepLinkListener((urls) => {
    if (!server.isLocal()) return

    for (const link of collectOpenProjectDeepLinks(urls)) {
      layout.projects.open(link.directory)
      layout.home.setSelection({ server: server.key, directory: link.directory })
      if (link.sessionId) {
        navigate(`/${base64Encode(link.directory)}/session/${link.sessionId}`)
        continue
      }
      navigate("/")
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      layout.projects.open(link.directory)
      layout.home.setSelection({ server: server.key, directory: link.directory })
      void openNewSession(tabs, server.key, link.directory, link.prompt)
    }
  })
}

async function openNewSession(
  tabs: ReturnType<typeof useTabs>,
  server: ServerConnection.Key,
  directory: string,
  prompt?: string,
) {
  if (!tabs.ready()) await tabs.ready.promise
  tabs.newDraft({ server, directory }, prompt)
}
