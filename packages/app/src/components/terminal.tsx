import type { TerminalProps } from "@opencode-ai/fork-terminal"
import { Terminal as ForkTerminal } from "@opencode-ai/fork-terminal"
import { useSDK } from "@/context/sdk"

type AppTerminalProps = Omit<TerminalProps, "sdk">

export const Terminal = (props: AppTerminalProps) => {
  const sdk = useSDK()
  return <ForkTerminal {...props} sdk={sdk} />
}
