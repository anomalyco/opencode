import type { IconProps } from "@expo/vector-icons/build/createIconSet"

export type SonnerType = "success" | "error" | "info" | "warning" | "loading" | "secondary"

export type SonnerIcon = {
  component: React.ComponentType<IconProps<any>>
  name: string
  size?: number
}

export interface SonnerConfig {
  id: string
  title: string
  type: SonnerType
  duration?: number // in milliseconds, default 3000 (ignored for loading type)
  onPress?: () => void
  icon?: SonnerIcon // Custom icon component and name
  color?: string // Custom color override
  persistent?: boolean // if true, won't auto-dismiss
  updatable?: boolean // if true, can be updated while showing
}

export interface SonnerUpdate {
  title?: string
  type?: SonnerType
  duration?: number
  onPress?: () => void
  icon?: SonnerIcon
  color?: string
  persistent?: boolean
}

export interface SonnerContextType {
  sonners: SonnerConfig[]
  showSonner: (config: Omit<SonnerConfig, "id">) => string
  updateSonner: (id: string, updates: SonnerUpdate) => void
  hideSonner: (id: string) => void
  clearAll: () => void
}
