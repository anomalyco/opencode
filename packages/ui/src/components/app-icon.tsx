import type { Component, ComponentProps } from "solid-js"
import { splitProps } from "solid-js"
import type { IconName } from "./app-icons/types"

import androidStudio from "../assets/icons/app/android-studio.svg"
import antigravity from "../assets/icons/app/antigravity.svg"
import cursor from "../assets/icons/app/cursor.svg"
import finder from "../assets/icons/app/finder.png"
import ghostty from "../assets/icons/app/ghostty.svg"
import iterm2 from "../assets/icons/app/iterm2.svg"
import powershell from "../assets/icons/app/powershell.svg"
import terminal from "../assets/icons/app/terminal.png"
import textmate from "../assets/icons/app/textmate.png"
import vscode from "../assets/icons/app/vscode.svg"
import xcode from "../assets/icons/app/xcode.png"
import zed from "../assets/icons/app/zed.svg"

const icons = {
  vscode,
  cursor,
  zed,
  finder,
  terminal,
  iterm2,
  ghostty,
  xcode,
  "android-studio": androidStudio,
  antigravity,
  textmate,
  powershell,
} satisfies Record<IconName, string>

export type AppIconProps = Omit<ComponentProps<"img">, "src"> & {
  id: IconName
}

export const AppIcon: Component<AppIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList", "alt", "draggable"])
  return (
    <img
      data-component="app-icon"
      {...rest}
      src={icons[local.id]}
      alt={local.alt ?? ""}
      draggable={local.draggable ?? false}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}
