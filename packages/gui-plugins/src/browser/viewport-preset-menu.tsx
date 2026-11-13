import { usePlugin } from "@opencode/plugin/gui"
import { Button } from "@opencode/ui/button"
import { Menu } from "@opencode/ui/menu"
import { For, Show } from "solid-js"
import { moreDevices, quickPresets, type Device } from "./viewport-presets"

export function ViewportPresetMenu(props: {
  selected?: Device["id"] | "custom"
  disabled: boolean
  onAuto: () => void
  onSelect: (device: Device) => void
}) {
  const plugin = usePlugin()

  const selectedLabel = () => {
    if (props.selected === "custom") return plugin.t("viewport.custom")

    return props.selected ? plugin.t(`viewport.device.${props.selected}`) : plugin.t("viewport.responsive")
  }

  const row = (device: Device) => (
    <Menu.RadioItem value={device.id} disabled={props.disabled} closeOnSelect onSelect={() => props.onSelect(device)}>
      {plugin.t(`viewport.device.${device.id}`)}
    </Menu.RadioItem>
  )

  return (
    <Menu placement="bottom-start" gutter={4} modal={false}>
      <Menu.Trigger
        as={Button}
        variant="ghost"
        size="small"
        data-slot="browser-viewport-preset-trigger"
        aria-label={plugin.t("viewport.preset")}
        aria-description={selectedLabel()}
        disabled={props.disabled}
      >
        <span>{selectedLabel()}</span>
        <span aria-hidden="true" data-slot="viewport-chevron" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content data-slot="browser-viewport-preset-menu" data-browser-popup>
          <Menu.RadioGroup value={props.selected ?? "auto"}>
            <Menu.RadioItem value="auto" closeOnSelect onSelect={props.onAuto}>
              {plugin.t("viewport.responsive")}
            </Menu.RadioItem>
            <Show when={props.selected === "custom"}>
              <Menu.RadioItem value="custom" closeOnSelect>
                {plugin.t("viewport.custom")}
              </Menu.RadioItem>
            </Show>
            <For each={quickPresets}>{row}</For>
          </Menu.RadioGroup>
          <Menu.Separator />
          <Menu.Sub gutter={4} overlap>
            <Menu.SubTrigger disabled={props.disabled}>{plugin.t("viewport.moreDevices")}</Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent data-slot="browser-viewport-preset-menu" data-device-list data-browser-popup>
                <Menu.RadioGroup value={props.selected ?? ""}>
                  <For each={moreDevices}>{row}</For>
                </Menu.RadioGroup>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
