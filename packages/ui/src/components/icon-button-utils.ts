import type { IconProps } from "./icon"

export function isStopIconButton(icon: IconProps["name"]) {
  return icon === "stop"
}
