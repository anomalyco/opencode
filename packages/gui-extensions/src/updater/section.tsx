import { createMemo, type JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { Preferences, useExtension } from "../sdk"
import { updaterAction } from "./action"
import type { UpdaterState } from "./contract"

export default function UpdatesSection(props: { state: () => UpdaterState | undefined; run: () => void }) {
  const ctx = useExtension()
  const preferences = ctx.use(Preferences)
  const action = createMemo(() => updaterAction(props.state()))

  return (
    <div class="settings-section">
      <h3 class="settings-section-title">{ctx.t("section.title")}</h3>

      <div data-component="settings-list">
        <Row title={ctx.t("releaseNotes.title")} description={ctx.t("releaseNotes.description")}>
          <div data-action="settings-release-notes">
            <Switch checked={preferences.releaseNotes()} onChange={(checked) => preferences.setReleaseNotes(checked)} />
          </div>
        </Row>

        <Row title={ctx.t("check.title")} description={ctx.t("check.description")}>
          <Button
            data-action="settings-check-updates"
            size="normal"
            variant="neutral"
            disabled={!action().run}
            onClick={() => props.run()}
          >
            {ctx.t(action().label)}
          </Button>
        </Row>
      </div>
    </div>
  )
}

// The host's settings row markup; its stylesheet is loaded with the settings screen.
function Row(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}
