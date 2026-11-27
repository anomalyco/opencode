import { createSignal, onCleanup, Show } from "solid-js"
import { unwrap } from "solid-js/store"
import { exportDesignCopy, importDesignCopy } from "./design-mode"
import { historyGroup } from "./history"
import { themes } from "./icons"
import { copySelection } from "~/lib/clipboard"
import { importSiteSettings, siteSettings } from "./settings"
import { parseTransfer, transferJson } from "./transfer"

type Theme = (typeof themes)[number]

/** Settings › Export and Import: moves the settings, Design mode copy and theme between browsers as JSON. */
export function SettingsTransfer(props: { theme: Theme; onTheme: (theme: Theme) => void }) {
  const [copied, setCopied] = createSignal(false)
  const [importing, setImporting] = createSignal(false)
  const [message, setMessage] = createSignal<{ kind: "success" | "error"; text: string }>()
  const timers: ReturnType<typeof setTimeout>[] = []
  onCleanup(() => timers.forEach(clearTimeout))
  let field: HTMLTextAreaElement | undefined
  let file: HTMLInputElement | undefined

  const json = () =>
    transferJson({ settings: unwrap(siteSettings), designCopy: exportDesignCopy(), theme: props.theme })

  const flash = (next: { kind: "success" | "error"; text: string }) => {
    setMessage(next)
    timers.push(setTimeout(() => setMessage((current) => (current === next ? undefined : current)), 3000))
  }

  const copy = () => {
    const text = json()
    // The in-app browser denies the Clipboard API, so fall back to a selection copy, which only
    // needs the click.
    const done = () => {
      setCopied(true)
      timers.push(setTimeout(() => setCopied(false), 1500))
    }
    const fallback = () =>
      copySelection(text) ? done() : flash({ kind: "error", text: "Could not copy. Use Download." })
    if (!navigator.clipboard?.writeText) return fallback()
    navigator.clipboard.writeText(text).then(done, fallback)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([json()], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "opencode-site-settings.json"
    document.body.append(link)
    link.click()
    link.remove()
    // Revoking at once can cancel the download before it starts in some browsers.
    timers.push(setTimeout(() => URL.revokeObjectURL(url), 1000))
  }

  const apply = (text: string) => {
    const data = parseTransfer(text)
    // The settings and the copy undo as one step.
    const imported =
      !!data &&
      historyGroup(() => {
        if (!importSiteSettings(data.settings)) return false
        if (data.designCopy !== undefined) importDesignCopy(data.designCopy)
        return true
      }, "Import settings")
    if (!data || !imported) {
      flash({ kind: "error", text: "Not a valid settings export." })
      return
    }
    const theme = themes.find((item) => item === data.theme)
    if (theme) props.onTheme(theme)
    setImporting(false)
    flash({ kind: "success", text: "Settings imported." })
  }

  const paste = () => {
    const blocked = () => {
      field?.focus()
      flash({ kind: "error", text: "Clipboard blocked. Paste into the field." })
    }
    if (!navigator.clipboard?.readText) return blocked()
    navigator.clipboard.readText().then((text) => {
      if (field) field.value = text
      apply(text)
    }, blocked)
  }

  return (
    <div data-slot="transfer">
      <div data-slot="transfer-row">
        <span>Configuration</span>
        <div data-slot="transfer-buttons">
          <button type="button" data-slot="jump" onClick={copy}>
            {copied() ? "Copied" : "Export"}
          </button>
          <button type="button" data-slot="jump" onClick={download}>
            Download .json
          </button>
          <button
            type="button"
            data-slot="jump"
            aria-expanded={importing() ? "true" : "false"}
            onClick={() => {
              setImporting(!importing())
              if (importing()) queueMicrotask(() => field?.focus())
            }}
          >
            Import
          </button>
        </div>
      </div>
      <Show when={importing()}>
        <textarea
          ref={field}
          data-slot="transfer-field"
          aria-label="Settings JSON"
          placeholder="Paste an export here"
          rows={4}
          spellcheck={false}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) apply(event.currentTarget.value)
            if (event.key === "Escape") {
              event.stopPropagation()
              setImporting(false)
            }
          }}
        />
        <div data-slot="transfer-buttons">
          <button type="button" data-slot="jump" onClick={() => apply(field?.value ?? "")}>
            Apply
          </button>
          <button type="button" data-slot="jump" onClick={paste}>
            Paste from clipboard
          </button>
          <button type="button" data-slot="jump" onClick={() => file?.click()}>
            Choose file
          </button>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (picked) picked.text().then(apply)
            }}
          />
        </div>
      </Show>
      <div role="status" data-slot="transfer-status">
        <Show when={message()}>
          {(current) => (
            <p data-slot="note" data-kind={current().kind}>
              {current().text}
            </p>
          )}
        </Show>
      </div>
    </div>
  )
}
