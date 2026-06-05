import type { Component, JSX } from "solid-js"
import "../settings-v2.css"

export const SettingsListV2: Component<{ children: JSX.Element }> = (props) => {
  return <div data-component="settings-v2-list">{props.children}</div>
}
