import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogCreateProject } from "@/components/dialog-create-project"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"

interface CreateProjectButtonProps {
  mobile?: boolean
  placement?: "top" | "bottom" | "left" | "right"
}

export function CreateProjectButton(props: CreateProjectButtonProps) {
  const dialog = useDialog()
  const layout = useLayout()
  const server = useServer()

  function handleClick() {
    dialog.show(
      () => (
        <DialogCreateProject
          onSuccess={(projectPath) => {
            // 添加到项目列表
            layout.projects.open(projectPath)
            server.projects.touch(projectPath)
          }}
        />
      ),
      () => {},
    )
  }

  return (
    <Tooltip placement={props.placement || "right"} value="创建项目">
      <IconButton
        icon="folder-add-left"
        variant="ghost"
        size="large"
        onClick={handleClick}
        aria-label="创建项目"
      />
    </Tooltip>
  )
}
