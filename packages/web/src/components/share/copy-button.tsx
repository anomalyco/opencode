import { createSignal } from "solid-js"
import { IconClipboard, IconCheckCircle } from "../icons"
import styles from "./copy-button.module.css"

interface CopyButtonProps {
  text: string
}

export function CopyButton(props: CopyButtonProps) {
  const [copied, setCopied] = createSignal(false)

  function handleCopyClick() {
    if (props.text) {
      navigator.clipboard.writeText(props.text).catch((err) => console.error("Copy failed", err))

      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div data-component="copy-button" class={styles.root}>
      <button type="button" onClick={handleCopyClick} data-copied={copied() ? true : undefined}>
        {copied() ? <IconCheckCircle width={16} height={16} /> : <IconClipboard width={16} height={16} />}
      </button>
    </div>
  )
}
