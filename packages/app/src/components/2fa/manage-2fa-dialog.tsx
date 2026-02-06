import { ManageTwoFactorDialog as ForkManageTwoFactorDialog } from "@opencode-ai/fork-ui"
import { useServer } from "@/context/server"

interface ManageTwoFactorDialogProps {
  onUpdate?: () => void
}

export function ManageTwoFactorDialog(props: ManageTwoFactorDialogProps) {
  const server = useServer()
  return <ForkManageTwoFactorDialog onUpdate={props.onUpdate} getServerUrl={() => server.url} />
}
