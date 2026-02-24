import { createMemo, For, Match, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() => {
    return sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })

  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function openProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory)
        }
      } else if (result) {
        openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  return (
    <div class="mx-auto w-full max-w-lg px-6 flex flex-col items-center" style="padding-top: min(20vh, 160px)">
      {/* Logo with entrance animation */}
      <div
        class="opacity-0"
        style="animation: fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.05s forwards"
      >
        <Logo class="w-40 md:w-56 opacity-20" />
      </div>

      {/* Server status badge */}
      <div
        class="opacity-0"
        style="animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.15s forwards"
      >
        <Button
          size="large"
          variant="ghost"
          class="mt-4 mx-auto text-14-regular text-text-weak"
          onClick={() => dialog.show(() => <DialogSelectServer />)}
        >
          <div
            classList={{
              "size-2 rounded-full": true,
              [serverDotClass()]: true,
            }}
          />
          {server.name}
        </Button>
      </div>

      <Switch>
        <Match when={sync.data.project.length > 0}>
          <div
            class="mt-12 w-full flex flex-col gap-3 opacity-0"
            style="animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.25s forwards"
          >
            <div class="flex gap-2 items-center justify-between pl-1 mb-1">
              <div class="text-12-medium text-text-weak uppercase tracking-wider">
                {language.t("home.recentProjects")}
              </div>
              <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
            <ul
              class="flex flex-col rounded-lg overflow-hidden"
              style="border: 1px solid var(--border-weaker-base); background: var(--surface-base)"
            >
              <For each={recent()}>
                {(project, i) => (
                  <li
                    class="opacity-0"
                    style={`animation: fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${0.3 + i() * 0.05}s forwards`}
                  >
                    <Button
                      size="large"
                      variant="ghost"
                      class="text-14-mono text-left justify-between px-4 py-2.5 w-full rounded-none"
                      style={i() < recent().length - 1 ? "border-bottom: 1px solid var(--border-weaker-base)" : ""}
                      onClick={() => openProject(project.worktree)}
                    >
                      <span class="truncate">{project.worktree.replace(homedir(), "~")}</span>
                      <span class="text-12-regular text-text-weaker flex-shrink-0 ml-4">
                        {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                      </span>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Match>
        <Match when={true}>
          <div
            class="mt-20 mx-auto flex flex-col items-center gap-4 opacity-0"
            style="animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.25s forwards"
          >
            <div
              class="w-16 h-16 rounded-2xl flex items-center justify-center"
              style="background: var(--surface-base); border: 1px solid var(--border-weaker-base)"
            >
              <Icon name="folder-add-left" size="large" />
            </div>
            <div class="flex flex-col gap-1 items-center justify-center">
              <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
              <div class="text-12-regular text-text-weak">{language.t("home.empty.description")}</div>
            </div>
            <Button class="px-4 mt-1" onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
