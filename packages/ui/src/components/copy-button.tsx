import { createSignal, type Accessor } from "solid-js"
import { Tooltip } from "./tooltip"
import { IconButton } from "./icon-button"

interface CopyButtonProps {
  text: Accessor<string | undefined>
}

export function CopyButton(props: CopyButtonProps) {
  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const content = props.text()
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Tooltip value={copied() ? "Copied!" : "Copy"} placement="top" gutter={8}>
      <IconButton icon={copied() ? "check" : "copy"} variant="secondary" onClick={handleCopy} />
    </Tooltip>
  )
}
