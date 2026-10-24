import { Button } from "@opencode/ui/button"
import { DockShell, DockTray } from "@opencode/ui/dock-surface"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { useDirectoryPicker } from "@/workspaces/selection/picker"

// Replaces the composer when a draft's folder no longer exists (a worktree removed outside the app). Without a Location
// the draft can load no models or agents, so it says why and offers another folder instead of an empty composer.
export function DraftLocationMissing(props: { directory: string; onChoose: (directory: string) => void }) {
  const language = useLanguage()
  const server = useServer()
  const pickDirectory = useDirectoryPicker()

  function choose() {
    pickDirectory({
      server: server.conn,
      title: language.t("session.location.choose"),
      onSelect: (result) => {
        const selected = Array.isArray(result) ? result[0] : result

        if (selected) props.onChoose(selected)
      },
    })
  }

  return (
    <div data-component="draft-location-missing">
      <DockShell class="flex flex-col gap-2 p-3">
        <div role="status" class="flex items-start gap-2 text-13-regular leading-[var(--line-height-base)]">
          <Icon name="warning" class="shrink-0 text-icon-warning-base" />
          <div class="min-w-0 flex flex-col gap-1">
            <div class="font-medium text-text-strong">{language.t("newSession.location.unavailable")}</div>
            <div class="break-all font-mono text-12-regular text-text-weak">{props.directory}</div>
            <div class="text-text-base">{language.t("newSession.location.description")}</div>
          </div>
        </div>
      </DockShell>
      <DockTray attach="top" class="flex flex-wrap justify-end gap-2 p-2 pt-[22px]">
        <Button variant="contrast" onClick={choose}>
          {language.t("session.location.choose")}
        </Button>
      </DockTray>
    </div>
  )
}
