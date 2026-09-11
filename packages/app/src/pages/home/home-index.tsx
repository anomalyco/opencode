import { createEffect, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@argus-ai/ui/v2/button-v2"
import { Mark } from "@argus-ai/ui/logo"
import { useLanguage } from "@/context/language"
import { draftHref, useTabs } from "@/context/tabs"
import { createHomeController } from "./home-controller"
import { createHomeProjectsController } from "./home-projects-controller"

// Home route: projects + sessions live in the persistent sidebar now, so `/`
// jumps straight into a composer. It reuses the newest draft when one exists,
// starts a fresh draft for the selected project otherwise, and only renders
// an empty state when there is no project to start from.
export function HomeIndex() {
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const tabs = useTabs()
  const navigate = useNavigate()
  const language = useLanguage()

  createEffect(() => {
    if (!tabs.ready()) return
    const draft = tabs.store.find((tab) => tab.type === "draft")
    if (draft && draft.type === "draft") {
      navigate(draftHref(draft.draftID), { replace: true })
      return
    }
    home.project.openNewSession()
  })

  const openProject = () => {
    const conn = home.server.focused() ?? home.server.list()[0]
    if (conn) projects.project.choose(conn)
  }

  return (
    <Show when={tabs.ready() && !home.project.newSession()}>
      <div class="glass-surface m-2 min-h-0 flex-1 self-stretch overflow-hidden rounded-[10px] shadow-[var(--v2-elevation-raised)]">
        <div class="mx-auto flex h-full w-full max-w-200 flex-col items-center justify-center gap-6 px-6 text-center">
          <Mark class="w-10" />
          <div class="flex flex-col items-center gap-2">
            <div class="text-20-medium text-text-strong">{language.t("home.empty.title")}</div>
            <div class="text-14-regular text-text-weak">{language.t("home.empty.description")}</div>
          </div>
          <ButtonV2 variant="contrast" size="normal" icon="folder-add-left" onClick={openProject}>
            {language.t("home.project.add")}
          </ButtonV2>
        </div>
      </div>
    </Show>
  )
}
