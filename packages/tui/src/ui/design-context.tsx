import { useConfig } from "../config"
import {
  icon as resolveIcon,
  radius,
  spacing,
  type ColorDepth,
  type IconMode,
  type IconName,
  type MotionPreference,
  type ResolvedMotion,
  type UiStyle,
} from "./design"

/** Reactive view over the resolved `ui` settings. Components read accessors so a config reload restyles in place. */
export function useDesign() {
  const config = useConfig()
  return {
    style: (): UiStyle => config.data.ui.style,
    colorDepth: (): ColorDepth => config.data.ui.color_depth,
    icons: (): IconMode => config.data.ui.icons,
    icon: (name: IconName): string => resolveIcon(name, config.data.ui.icons),
    motion: (): MotionPreference => config.data.ui.motion,
    reducedMotion: (): boolean => config.data.ui.motion === ("reduced" satisfies ResolvedMotion),
    mono: (): boolean => config.data.ui.mono,
    spacing,
    radius,
  }
}
