import type { Component, ComponentProps } from "solid-js"
import { createSignal, onCleanup, onMount, splitProps } from "solid-js"
import type { IconName } from "./app-icons/types"

import androidStudio from "../assets/icons/app/android-studio.svg"
import antigravity from "../assets/icons/app/antigravity.svg"
import cursor from "../assets/icons/app/cursor.svg"
import fileExplorer from "../assets/icons/app/file-explorer.svg"
import finder from "../assets/icons/app/finder.png"
import ghostty from "../assets/icons/app/ghostty.svg"
import iterm2 from "../assets/icons/app/iterm2.svg"
import powershell from "../assets/icons/app/powershell.svg"
import terminal from "../assets/icons/app/terminal.png"
import textmate from "../assets/icons/app/textmate.png"
import vscode from "../assets/icons/app/vscode.svg"
import warp from "../assets/icons/app/warp.png"
import xcode from "../assets/icons/app/xcode.png"
import zed from "../assets/icons/app/zed.svg"
import zedDark from "../assets/icons/app/zed-dark.svg"
import sublimetext from "../assets/icons/app/sublimetext.svg"

const icons = {
  vscode,
  cursor,
  zed,
  "file-explorer": fileExplorer,
  finder,
  terminal,
  iterm2,
  ghostty,
  warp,
  xcode,
  "android-studio": androidStudio,
  antigravity,
  textmate,
  powershell,
  "sublime-text": sublimetext,
} satisfies Record<IconName, string>

const themed: Partial<Record<IconName, { light: string; dark: string }>> = {
  zed: {
    light: zed,
    dark: zedDark,
  },
}

const scheme = () => {
  if (typeof document !== "object") return "light" as const
  if (document.documentElement.dataset.colorScheme === "dark") return "dark" as const
  return "light" as const
}

export type AppIconProps = Omit<ComponentProps<"img">, "src"> & {
  id: IconName
}

export const AppIcon: Component<AppIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList", "alt", "draggable"])
  const [mode, setMode] = createSignal(scheme())

  onMount(() => {
    const sync = () => setMode(scheme())
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme"],
    })
    sync()
    onCleanup(() => observer.disconnect())
  })

  return (
    <img
      data-component="app-icon"
      {...rest}
      src={themed[local.id]?.[mode()] ?? icons[local.id]}
      alt={local.alt ?? ""}
      draggable={local.draggable ?? false}
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
    />
  )
}
