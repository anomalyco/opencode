import { createMemo, For, Match, Show, Switch } from "solid-js"
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
import { DialogAddProject } from "@/components/dialog-add-project"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogRegisterWorkspace } from "@/components/dialog-register-workspace"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useHosted } from "@/context/hosted"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const hosted = useHosted()
  const homedir = createMemo(() => sync.data.path.home)
  const canChoose = createMemo(() => server.isLocal() || !hosted.enabled() || hosted.isAdmin())
  const hostedMode = createMemo(() => hosted.enabled() && !server.isLocal())
  const workspaces = createMemo(() => hosted.workspaces())
  const actionLabel = createMemo(() =>
    hostedMode() ? (hosted.isAdmin() ? "Register workspace" : "Shared workspaces") : language.t("command.project.open"),
  )
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
    if (hostedMode()) {
      if (!hosted.isAdmin()) return
      dialog.show(() => <DialogRegisterWorkspace onCreated={openProject} />)
      return
    }

    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory)
        }
      } else if (result) {
        openProject(result)
      }
    }

    function openExisting() {
      if (platform.openDirectoryPickerDialog && server.isLocal()) {
        platform
          .openDirectoryPickerDialog?.({
            title: language.t("command.project.open"),
            multiple: true,
          })
          .then(resolve)
      } else {
        dialog.show(
          () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
          () => resolve(null),
        )
      }
    }

    dialog.show(
      () => <DialogAddProject onResolve={resolve} openExisting={openExisting} />,
      () => resolve(null),
    )
  }

  return (
    <div class="mx-auto mt-55 w-full md:w-auto px-4">
      <Logo class="md:w-xl opacity-12" />
      <Button
        size="large"
        variant="ghost"
        class="mt-4 mx-auto text-14-regular text-text-weak"
        onClick={() => dialog.show(() => <DialogSelectServer />)}
      >
        <div
          classList={{
            "size-2 rounded-full": true,
            "bg-icon-success-base": server.healthy() === true,
            "bg-icon-critical-base": server.healthy() === false,
            "bg-border-weak-base": server.healthy() === undefined,
          }}
        />
        {server.name}
      </Button>
      <Switch>
        <Match when={hostedMode() ? workspaces().length > 0 : sync.data.project.length > 0}>
          <div class="mt-20 w-full flex flex-col gap-4">
            <div class="flex gap-2 items-center justify-between pl-3">
              <div class="text-14-medium text-text-strong">
                {hostedMode() ? "Shared workspaces" : language.t("home.recentProjects")}
              </div>
              <Show when={canChoose()}>
                <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                  {actionLabel()}
                </Button>
              </Show>
            </div>
            <ul class="flex flex-col gap-2">
              <Show
                when={hostedMode()}
                fallback={
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
                }
              >
                <For each={workspaces()}>
                  {(workspace) => (
                    <Button
                      size="large"
                      variant="ghost"
                      class="text-left justify-between px-3"
                      onClick={() => openProject(workspace.path)}
                    >
                      <div class="min-w-0 flex flex-col items-start">
                        <div class="text-14-medium text-text-strong truncate">{workspace.name}</div>
                        <div class="text-12-regular text-text-weak truncate">{workspace.path.replace(homedir(), "~")}</div>
                      </div>
                    </Button>
                  )}
                </For>
              </Show>
            </ul>
          </div>
        </Match>
        <Match when={true}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <Icon name="folder-add-left" size="large" />
            <div class="flex flex-col gap-1 items-center justify-center">
              <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
              <div class="text-12-regular text-text-weak">
                {hostedMode()
                  ? hosted.isAdmin()
                    ? "Register the first shared workspace to get started."
                    : "No shared workspaces have been registered yet."
                  : language.t("home.empty.description")}
              </div>
            </div>
            <div />
            <Show when={canChoose()}>
              <Button class="px-3" onClick={chooseProject}>
                {actionLabel()}
              </Button>
            </Show>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
