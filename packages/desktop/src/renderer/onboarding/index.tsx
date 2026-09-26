import {
  formatServerError,
  ServerConnection,
  useCurrentRoute,
  useGlobal,
  useLanguage,
  useServers,
  useTabs,
} from "@opencode/app/desktop"
import { showToast } from "@opencode/ui/toast"
import { createResource } from "solid-js"
import type { ElectronAPI } from "../api-types"

export function DesktopFirstLaunchOnboarding(props: {
  api: ElectronAPI
  serverKey: ServerConnection.Key
  initialUrl: string
  pending: boolean
  onReady: () => void
}) {
  const server = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const route = useCurrentRoute()
  const language = useLanguage()

  const [completed] = createResource(async () => {
    await runFirstLaunchOnboarding()
    return null
  })

  async function runFirstLaunchOnboarding() {
    try {
      if (!props.pending) return

      await Promise.all([tabs.ready.promise, tabs.recentReady.promise].map((p) => p ?? Promise.resolve()))

      const shouldTrigger =
        props.initialUrl === "/" &&
        route().type === "home" &&
        tabs.store.length === 0 &&
        server.list.every(ServerConnection.builtin)

      console.info("[desktop-onboarding] first launch onboarding evaluated", {
        pending: props.pending,
        shouldTrigger,
        initialUrl: props.initialUrl,
        tabs: tabs.store.length,
        servers: server.list.map(ServerConnection.key),
      })

      const directory = await props.api.finishFirstLaunchOnboarding(shouldTrigger)
      if (directory && typeof directory !== "string") {
        showToast({
          variant: "error",
          persistent: true,
          title: language.t("toast.project.defaultUnavailable.title"),
          description: language.t("error.project.permissionDenied", { directory: directory.permissionDenied }),
        })
        return
      }
      if (!shouldTrigger || !directory) return

      console.info("[desktop-onboarding] starting first launch draft", { directory })
      const connection = server.list.find((connection) => ServerConnection.key(connection) === props.serverKey)
      if (connection) {
        const context = global.ensureServerCtx(connection)
        const failure = await context.sdk.api.location.get({ location: { directory } }).then(
          () => undefined,
          (error: unknown) => ({ error }),
        )
        if (failure) {
          showToast({
            variant: "error",
            persistent: true,
            title: language.t("toast.project.defaultUnavailable.title"),
            description: formatServerError(
              failure.error,
              language.t,
              language.t("error.project.unavailable", { directory }),
            ),
          })
          return
        }
        const data = context.data
        // Load the initial provider/model state before the draft transition exposes the composer.
        await Promise.all([data.location.provider.sync({ directory }), data.location.model.sync({ directory })])
      }
      const projects = server.projects.forServer(props.serverKey)
      projects.open(directory)
      projects.touch(directory)
      tabs.select(await tabs.newDraft({ server: props.serverKey, directory }))
    } finally {
      props.onReady()
    }
  }

  // Let startup failures reach the app's recovery screen, including its splash boundary.
  return <>{completed()}</>
}
