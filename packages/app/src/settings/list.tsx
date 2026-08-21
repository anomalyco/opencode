import type { Component, JSX } from "solid-js"
import "@/settings/settings.css"

export const SettingsList: Component<{ children: JSX.Element }> = (props) => {
  return <div data-component="settings-list">{props.children}</div>
}
