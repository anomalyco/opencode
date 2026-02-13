import { createMemo, For, Match, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { ClaxedoLogo } from "@claxedo/claxedo-ui/components/claxedo-logo"
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
import { getExtensions } from "@opencode-ai/app-shared"
import { StatusPopover } from "@/components/status-popover"

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
      .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })

  function openProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  async function chooseProject() {
    const ext = getExtensions()

    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory)
        }
      } else if (result) {
        openProject(result)
      }
    }

    // Use extension-provided web project dialog if available (cloud mode)
    if (platform.platform === "web" && ext.app.webProjectDialog) {
      const WebProjectDialog = ext.app.webProjectDialog
      dialog.show(
        () => <WebProjectDialog onSelect={resolve} />,
        () => resolve(null)
      )
      return
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

  const ext = getExtensions()
  const serverSelectorMode = () => ext.app.serverSelectorMode ?? "full"

  return (
    <div class="mx-auto mt-55 w-full md:w-auto px-4">
      <ClaxedoLogo class="md:w-xl opacity-12" />
      <Switch>
        <Match when={serverSelectorMode() === "status-only"}>
          <div class="mt-4 mx-auto flex items-center justify-center">
            <StatusPopover triggerClass="flex items-center gap-2 px-3 py-1.5 rounded-md text-14-regular text-text-weak hover:bg-surface-raised-base-hover transition-colors" />
          </div>
        </Match>
        <Match when={serverSelectorMode() === "full"}>
          <div class="mt-4 mx-auto flex items-center justify-center">
            <StatusPopover triggerClass="flex items-center gap-2 px-3 py-1.5 rounded-md text-14-regular text-text-weak hover:bg-surface-raised-base-hover transition-colors" />
          </div>
        </Match>
      </Switch>
      <Switch>
        <Match when={sync.data.project.length > 0}>
          <div class="mt-20 w-full flex flex-col gap-4">
            <div class="flex gap-2 items-center justify-between pl-3">
              <div class="text-14-medium text-text-strong">{language.t("home.recentProjects")}</div>
              <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
            <ul class="flex flex-col gap-2">
              <For each={recent()}>
                {(project) => (
                  <Button
                    size="large"
                    variant="ghost"
                    class="text-14-mono text-left justify-between px-3"
                    onClick={() => openProject(project.worktree)}
                  >
                    {project.worktree.replace(homedir(), "~")}
                    <div class="text-14-regular text-text-weak">
                      {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                    </div>
                  </Button>
                )}
              </For>
            </ul>
          </div>
        </Match>
        <Match when={true}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <Icon name="folder-add-left" size="large" />
            <div class="flex flex-col gap-1 items-center justify-center">
              <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
              <div class="text-12-regular text-text-weak">{language.t("home.empty.description")}</div>
            </div>
            <div />
            <Button class="px-3" onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
