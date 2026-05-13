import { createEffect, createMemo, For, Match, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
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

  createEffect(() => {
    if (!sync.ready) return
    const directory = sync.data.path.directory
    if (directory) {
      navigate(`/${base64Encode(directory)}`)
    }
  })
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
    <div data-component="lovable-home" class="size-full min-h-dvh overflow-hidden">
      <div class="size-full min-h-0 flex">
        <aside
          data-component="lovable-home-sidebar"
          class="hidden md:flex w-58 shrink-0 flex-col gap-4 px-3 py-4"
          aria-label={language.t("sidebar.nav.projectsAndSessions")}
        >
          <div class="flex items-center gap-2 px-2">
            <div class="size-7 rounded-lg bg-surface-interactive-base flex items-center justify-center text-text-interactive-base">
              <Icon name="folder" size="small" />
            </div>
            <div class="min-w-0">
              <div class="truncate text-13-medium text-text-strong">opencode</div>
              <Button
                size="small"
                variant="ghost"
                class="!h-5 !px-0 text-12-regular text-text-weak"
                onClick={() => dialog.show(() => <DialogSelectServer />)}
              >
                <div classList={{ "size-1.5 rounded-full": true, [serverDotClass()]: true }} />
                {server.name}
              </Button>
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <Button variant="ghost" icon="folder-add-left" onClick={chooseProject}>
              {language.t("command.project.open")}
            </Button>
          </div>

          <div class="mt-3 px-2 text-12-medium text-text-weak">{language.t("home.recentProjects")}</div>
          <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto no-scrollbar">
            <For each={recent()}>
              {(project) => (
                <Button
                  size="normal"
                  variant="ghost"
                  class="min-w-0 text-left text-12-medium"
                  onClick={() => openProject(project.worktree)}
                >
                  <span class="truncate">{project.worktree.replace(homedir(), "~")}</span>
                </Button>
              )}
            </For>
          </div>
        </aside>

        <main class="min-w-0 flex-1 overflow-y-auto no-scrollbar">
          <div class="mx-auto flex min-h-full w-full max-w-7xl flex-col px-4 pb-4 pt-8 md:px-8 md:pt-20">
            <section class="flex min-h-[360px] flex-col items-center justify-center gap-6 text-center md:min-h-[520px]">
              <Button
                size="small"
                variant="secondary"
                class="gap-2 !px-3 text-12-medium"
                onClick={() => dialog.show(() => <DialogSelectServer />)}
              >
                <div classList={{ "size-1.5 rounded-full": true, [serverDotClass()]: true }} />
                {server.name}
              </Button>
              <div class="text-[28px] md:text-[36px] font-medium leading-[1.1] tracking-normal text-text-strong">
                {language.t("home.empty.title")}
              </div>
              <div data-component="lovable-home-prompt" class="w-full max-w-144 px-4 py-3 text-left">
                <button
                  type="button"
                  class="w-full min-h-13 text-left text-14-regular text-text-weak focus:outline-none"
                  onClick={chooseProject}
                >
                  {language.t("home.empty.description")}
                </button>
              </div>
            </section>

            <section data-component="lovable-home-projects" class="min-h-64 w-full p-4 md:p-6">
              <div class="flex items-center justify-between gap-4">
                <div data-component="lovable-home-tabs" class="flex items-center gap-1">
                  <div data-component="lovable-home-tab" data-active="true" class="px-3 py-1 text-12-medium">
                    {language.t("home.recentProjects")}
                  </div>
                </div>
                <Button size="normal" variant="ghost" class="gap-1 px-3" onClick={chooseProject}>
                  {language.t("command.project.open")}
                  <Icon name="arrow-right" size="small" />
                </Button>
              </div>

              <Switch>
                <Match when={sync.data.project.length > 0}>
                  <ul class="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <For each={recent()}>
                      {(project) => (
                        <li>
                          <button
                            type="button"
                            data-component="lovable-project-card"
                            class="block w-full overflow-hidden p-3 text-left"
                            onClick={() => openProject(project.worktree)}
                          >
                            <div data-component="lovable-project-preview" class="aspect-[16/9] rounded-xl" />
                            <div class="mt-3 flex min-w-0 items-center gap-3">
                              <div class="size-8 shrink-0 rounded-full bg-surface-interactive-base flex items-center justify-center text-text-interactive-base">
                                <Icon name="folder" size="small" />
                              </div>
                              <div class="min-w-0">
                                <div class="truncate text-14-medium text-text-strong">
                                  {project.worktree.replace(homedir(), "~")}
                                </div>
                                <div class="text-12-regular text-text-weak">
                                  {DateTime.fromMillis(project.time.updated ?? project.time.created)
                                    .setLocale(language.intl())
                                    .toRelative()}
                                </div>
                              </div>
                            </div>
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Match>
                <Match when={!sync.ready}>
                  <div class="flex min-h-44 flex-col items-center justify-center gap-3 text-center">
                    <div class="text-12-regular text-text-weak">{language.t("common.loading")}</div>
                  </div>
                </Match>
                <Match when={true}>
                  <div class="flex min-h-44 flex-col items-center justify-center gap-3 text-center">
                    <Icon name="folder-add-left" size="large" />
                    <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
                    <Button class="px-3" onClick={chooseProject}>
                      {language.t("command.project.open")}
                    </Button>
                  </div>
                </Match>
              </Switch>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
