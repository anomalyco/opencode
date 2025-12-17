import { useGlobalSync } from "@/context/global-sync"
import { createMemo, For, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const navigate = useNavigate()
  const homedir = createMemo(() => sync.data.path.home)

  function openProject(directory: string) {
    layout.projects.open(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  async function chooseProject() {
    const result = await platform.openDirectoryPickerDialog?.({
      title: "Open project",
      multiple: true,
    })
    if (Array.isArray(result)) {
      for (const directory of result) {
        openProject(directory)
      }
    } else if (result) {
      openProject(result)
    }
  }

  return (
    <div class="mx-auto mt-55">
      <Logo class="w-xl opacity-12" />
      <Switch>
        <Match when={sync.data.project.length > 0}>
          <div class="mt-20 w-full flex flex-col gap-4">
            <div class="flex gap-2 items-center justify-between pl-3">
              <div class="text-14-medium text-text-strong">Recent projects</div>
              <Show when={platform.openDirectoryPickerDialog}>
                <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                  Open project
                </Button>
              </Show>
            </div>
            <ul class="flex flex-col gap-2">
              <For
                each={sync.data.project
                  .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
                  .slice(0, 5)}
              >
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
              <div class="text-14-medium text-text-strong">No recent projects</div>
              <div class="text-12-regular text-text-weak">Get started by opening a local project</div>
            </div>
            <div />
            <Show when={platform.openDirectoryPickerDialog}>
              <Button class="px-3" onClick={chooseProject}>
                Open project
              </Button>
            </Show>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
