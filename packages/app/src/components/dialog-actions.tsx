import type { JSX } from "solid-js"
import { DialogSelectProvider } from "@/components/dialog-select-provider"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSettings } from "@/components/dialog-settings"

type Dialog = {
  show: (render: () => JSX.Element, onClose?: () => void) => void
}

export const showProviderDialog = (dialog: Dialog) => dialog.show(() => <DialogSelectProvider />)

export const showServerDialog = (dialog: Dialog) => dialog.show(() => <DialogSelectServer />)

export const showSettingsDialog = (dialog: Dialog) => dialog.show(() => <DialogSettings />)
