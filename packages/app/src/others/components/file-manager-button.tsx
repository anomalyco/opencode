/**
 * 文件管理按钮组件
 * 点击打开文件管理面板
 */

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { FileManagerPanel } from "./file-manager-panel"

interface FileManagerButtonProps {
  placement?: "top" | "bottom" | "left" | "right"
}

/**
 * 文件管理按钮
 */
export const FileManagerButton = (props: FileManagerButtonProps) => {
  const dialog = useDialog()

  function handleClick() {
    dialog.show(() => <FileManagerPanel />, () => {})
  }

  return (
    <IconButton
      icon="folder"
      variant="ghost"
      size="large"
      onClick={handleClick}
      aria-label="文件管理"
    />
  )
}
