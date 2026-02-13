import { createMemo, createResource, createSignal } from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { usePlatform } from "@/context/platform"
import { useLayout } from "@/context/layout"
import { useTerminal } from "@/context/terminal"
import { useSDK } from "@/context/sdk"
import { decode64 } from "@/utils/base64"
import { getFilename } from "@opencode-ai/util/path"

export function SettingsPopup() {
  const params = useParams()
  const sdk = useSDK()
  const platform = usePlatform()
  const layout = useLayout()
  const terminal = useTerminal()
  const project = createMemo(() => getFilename(decode64(params.dir) ?? params.dir))
  const [email, setEmail] = createSignal("")
  const dev = createMemo(() => {
    if (typeof window !== "object") return ""
    if (!window.location?.hostname) return ""
    return `http://${window.location.hostname}/preview`
  })
  const [config, { refetch }] = createResource(
    () => sdk.directory,
    () =>
      sdk.client.file
        .read({ path: "latervibe.json" })
        .then((res) => {
          const data = res.data
          const content = typeof data === "string" ? data : data?.content
          if (!content) return null
          return Promise.resolve()
            .then(
              () =>
                JSON.parse(content) as {
                  url?: string
                  productionUrl?: string
                  production_url?: string
                  userAccessCache?: unknown
                },
            )
            .catch(() => null)
        })
        .catch(() => null),
  )
  const prod = createMemo(() => {
    const value = config()
    if (!value) return ""
    return value.url || value.productionUrl || value.production_url || ""
  })
  const access = createMemo(() => {
    const value = config()
    if (!value) return [] as string[]
    const cached = value.userAccessCache
    if (Array.isArray(cached)) {
      return cached
        .filter((item) => typeof item === "string")
        .map((item) => item.replace(/^user:/, "").trim())
        .filter(Boolean)
    }
    if (typeof cached === "string") {
      return cached
        .split(/\r?\n/)
        .map((item) => item.replace(/^user:/, "").trim())
        .filter(Boolean)
    }
    return []
  })

  const openLink = (url: string) => {
    if (!url) return
    platform.openLink(url)
  }

  const runAccess = (input: { action: "grant" | "remove" | "list"; value?: string }) => {
    if (!params.dir) {
      showToast({
        variant: "error",
        title: "Access failed",
        description: "Open a project before running commands.",
      })
      return
    }

    const cwd = decode64(params.dir) ?? params.dir
    const key = `${params.dir}${params.id ? "/" + params.id : ""}`
    layout.view(key).terminal.open()
    terminal.run({
      command: "latervibe",
      args: ["access", input.action, ...(input.value ? [input.value] : [])],
      title: "Access",
      cwd,
    })
    window.setTimeout(() => {
      refetch()
    }, 1200)
  }

  const addUser = () => {
    const value = email().trim()
    if (!value) return
    runAccess({ action: "grant", value })
    setEmail("")
  }

  const removeUser = (value: string) => {
    runAccess({ action: "remove", value })
  }

  const runList = () => {
    runAccess({ action: "list" })
  }

  const runAuth = () => {
    if (!params.dir) {
      showToast({
        variant: "error",
        title: "Authentication failed",
        description: "Open a project before running commands.",
      })
      return
    }

    const cwd = decode64(params.dir) ?? params.dir
    const key = `${params.dir}${params.id ? "/" + params.id : ""}`
    layout.view(key).terminal.open()
    terminal.run({ command: "gcloud", args: ["auth", "login"], title: "Google Auth", cwd })
  }

  return (
    <Popover
      title={`Settings: ${project() || "Project"}`}
      description="LaterVibe Project Settings"
      gutter={6}
      placement="bottom-end"
      class="rounded-xl [&_[data-slot=popover-close-button]]:hidden"
      triggerAs={Button}
      triggerProps={{
        variant: "secondary",
        class: "rounded-sm h-[24px] w-[24px] p-0",
        style: { scale: 1 },
        "aria-label": "Settings",
      }}
      trigger={<Icon name="settings-gear" size="small" class="text-icon-base" />}
    >
      <div class="flex flex-col gap-4 text-12-regular text-text-strong w-[320px] max-w-full">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <span class="text-12-regular text-text-weak w-[56px] shrink-0">Dev</span>
            <TextField value={dev()} readOnly copyable class="flex-1 min-w-0" />
            <Button variant="secondary" class="h-[28px] shrink-0" onClick={() => openLink(dev())} disabled={!dev()}>
              Open
            </Button>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-12-regular text-text-weak w-[56px] shrink-0">Prod</span>
            <TextField value={prod()} readOnly copyable class="flex-1 min-w-0" />
            <Button
              variant="secondary"
              class="h-[28px] shrink-0"
              onClick={() => openLink(prod())}
              disabled={!prod()}
            >
              Open
            </Button>
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <span class="text-12-regular text-text-weak w-[56px] shrink-0">Access</span>
            <TextField
              value={email()}
              onInput={(event) => setEmail(event.currentTarget.value)}
              placeholder="Email"
              class="flex-1 min-w-0"
            />
            <Button variant="secondary" class="h-[28px] shrink-0" onClick={addUser}>
              Add
            </Button>
            <Button variant="secondary" class="h-[28px] shrink-0" onClick={runList}>
              Refresh
            </Button>
          </div>
          <div class="flex flex-wrap gap-2">
            {access().map((item) => (
              <div class="flex items-center gap-1 rounded-sm border border-border-weak-base px-2 py-1">
                <span class="text-12-regular text-text-strong">{item}</span>
                <Button variant="ghost" class="h-[20px] w-[20px] p-0" onClick={() => removeUser(item)}>
                  <Icon name="close-small" size="small" class="text-icon-weak" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-12-regular text-text-weak">Authentication with Google</span>
          <Button variant="secondary" class="h-[28px] shrink-0" onClick={runAuth}>
            Login
          </Button>
        </div>
      </div>
    </Popover>
  )
}
