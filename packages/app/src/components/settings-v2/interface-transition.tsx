import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export function LayoutTransitionToggle(props: {
  title: string
  badge: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div class="settings-v2-section">
      <div class="settings-v2-interface-feature">
        <SettingsListV2>
          <SettingsRowV2
            title={
              <span class="flex items-center gap-2">
                {props.title}
                <Tag variant="accent">{props.badge}</Tag>
              </span>
            }
            description={props.description}
          >
            <div data-action="settings-new-layout-designs">
              <Switch checked={props.checked} onChange={props.onChange} />
            </div>
          </SettingsRowV2>
        </SettingsListV2>
      </div>
    </div>
  )
}

export function LayoutRetirementNotice(props: {
  title: string
  description: string
  dismiss: string
  onDismiss: () => void
}) {
  return (
    <div class="settings-v2-section">
      <SettingsListV2>
        <SettingsRowV2 title={props.title} description={props.description}>
          <ButtonV2 size="small" variant="ghost-muted" onClick={props.onDismiss}>
            {props.dismiss}
          </ButtonV2>
        </SettingsRowV2>
      </SettingsListV2>
    </div>
  )
}
