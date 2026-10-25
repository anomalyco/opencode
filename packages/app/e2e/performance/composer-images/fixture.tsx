/// <reference types="vite/client" />
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { PlatformProvider, type Platform } from "@/runtime/platform/platform"
import { createBrowserDraftStore, resolveBlobUrl } from "@/runtime/persistence/drafts"
import { persistStore } from "@/runtime/persistence/persist"
import { ComposerEditor } from "@/composer/editor/editor"
import { createComposerEditor } from "@/composer/editor/interaction"
import type { ComposerPersistedState } from "@/composer/types"
import "@/index.css"

const drafts = createBrowserDraftStore()

const platform: Platform = {
  platform: "web",
  draftStore: drafts,
  openExternal() {},
  restart: async () => {},
  notify: async () => {},
}

function Fixture() {
  const [state, setState] = createStore<ComposerPersistedState>({
    prompt: [{ type: "text", content: "", start: 0, end: 0 }],
    cursor: 0,
    context: { items: [] },
  })

  const [preview, setPreview] = createStore({ url: "", name: "" })

  const persistence = persistStore({
    store: state,
    setStore: setState,
    name: "image-paste-benchmark",
    storage: drafts,
    serialize: JSON.stringify,
    deserialize: JSON.parse,
    write: (value) => {
      void drafts.setDocument("image-paste-benchmark", value)
    },
  })

  let editor: HTMLElement | undefined

  const controller = createComposerEditor({
    store: [state, persistence.setStore],
    commands: () => [],
    context: () => [],
    searchContextFiles: () => [],
    onEditor: (element) => {
      editor = element
    },
    openAttachment: async (attachment) => {
      if (attachment.type !== "image") return
      const url = await resolveBlobUrl(attachment.blob)
      setPreview({ url: url ?? "", name: attachment.filename })
    },
    attachments: {
      directory: () => "/benchmark",
      destination: () => ({
        input: { image: true, pdf: true },
        local: true,
        upload: async () => {
          throw new Error("Benchmark must not upload")
        },
      }),
      isDialogActive: () => false,
      duplicate() {},
      onError: console.error,
      onUploadError: console.error,
      store: drafts.putBlob,
    },
    view: {
      placeholder: () => "Type after pasting images",
      submit: { stopping: () => false, onSubmit() {}, onStop() {} },
    },
  })

  return (
    <main style={{ padding: "40px", width: "900px" }}>
      <h1>Production composer: large image paste</h1>
      <label>
        Clipboard fixtures
        <input
          type="file"
          multiple
          onChange={(event) => {
            const data = new DataTransfer()
            Array.from(event.currentTarget.files ?? []).forEach((file) => data.items.add(file))
            editor?.focus()
            editor?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
          }}
        />
      </label>
      <ComposerEditor controller={controller} />
      <output data-testid="attachment-count">{controller.attachments().length}</output>
      <button
        onClick={() => {
          controller.attachments().forEach((attachment) => controller.removeAttachment(attachment.id))
          setPreview({ url: "", name: "" })
        }}
      >
        Remove all images
      </button>
      <details>
        <summary>Full original preview</summary>
        <img src={preview.url || undefined} alt={preview.name} />
      </details>
    </main>
  )
}

render(
  () => (
    <PlatformProvider value={platform}>
      <Fixture />
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
