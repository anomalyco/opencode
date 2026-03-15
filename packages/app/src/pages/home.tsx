import { createEffect, createMemo, For, Match, Switch } from "solid-js"
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

  createEffect(() => {
    document.title = "Acompany Secure Code"
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
    <div class="relative min-h-[calc(100dvh-2px)] overflow-hidden bg-[#1e3a5f] text-white">
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_30%),radial-gradient(circle_at_bottom,rgba(0,0,0,0.2),transparent_34%)] opacity-90" />
      <div class="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.55)_1px,transparent_0)] [background-size:18px_18px]" />
      <div class="mx-auto mt-40 w-full px-4 md:w-auto">
        <Logo class="w-full max-w-[920px] md:w-[920px]" />
        <Button
          size="large"
          variant="ghost"
          class="mt-7 mx-auto flex-col gap-1 border border-white/10 bg-[#17395a]/65 px-4 py-3 text-white shadow-[0_14px_40px_rgba(0,0,0,0.18)] backdrop-blur-sm"
          onClick={() => dialog.show(() => <DialogSelectServer />)}
        >
          <div class="flex items-center gap-2 text-14-regular">
            <div
              classList={{
                "size-2 rounded-full": true,
                [serverDotClass()]: true,
              }}
            />
            Secure endpoint connected
          </div>
          <div class="font-mono text-12-regular text-white/65">{server.name}</div>
        </Button>
        <Switch>
          <Match when={sync.data.project.length > 0}>
            <div class="mt-18 w-full flex flex-col gap-4">
              <div class="flex gap-2 items-center justify-between pl-3">
                <div class="flex flex-col gap-1">
                  <div class="text-14-medium text-white">Recent secure workspaces</div>
                  <div class="text-12-regular text-white/60">{language.t("home.recentProjects")}</div>
                </div>
                <Button
                  icon="folder-add-left"
                  size="normal"
                  class="border border-white/12 bg-[#17395a]/70 pl-2 pr-3 text-white hover:bg-[#153451]"
                  onClick={chooseProject}
                >
                  {language.t("command.project.open")}
                </Button>
              </div>
              <ul class="flex flex-col gap-2">
                <For each={recent()}>
                  {(project) => (
                    <Button
                      size="large"
                      variant="ghost"
                      class="border border-white/8 bg-[#17395a]/60 px-3 text-left justify-between font-mono text-white hover:bg-[#17395a]/80"
                      onClick={() => openProject(project.worktree)}
                    >
                      {project.worktree.replace(homedir(), "~")}
                      <div class="text-14-regular text-white/55">
                        {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                      </div>
                    </Button>
                  )}
                </For>
              </ul>
            </div>
          </Match>
          <Match when={true}>
            <div class="mt-28 mx-auto flex flex-col items-center gap-3">
              <Icon name="folder-add-left" size="large" class="text-white/80" />
              <div class="flex flex-col gap-1 items-center justify-center">
                <div class="text-14-medium text-white">セキュアワークスペースを開いて開始</div>
                <div class="text-12-regular text-white/60">リポジトリを選ぶと、SecureCode ルートでそのまま操作できます</div>
              </div>
              <Button class="mt-1 border border-white/12 bg-[#17395a]/70 px-3 text-white hover:bg-[#153451]" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
      <div class="pointer-events-none absolute bottom-6 right-8 opacity-95">
        <img
          src="/acompany-logotype-white.svg"
          alt="Acompany"
          class="w-[180px] drop-shadow-[0_10px_24px_rgba(0,0,0,0.22)]"
        />
      </div>
    </div>
  )
}
