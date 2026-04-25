import { lazy, Match, Suspense, Switch, type JSX } from "solid-js"
import type { MediaKind } from "../../pierre/media"

const PdfViewer = lazy(() => import("./pdf").then((m) => ({ default: m.PdfViewer })))

function CenteredLoading(): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "min-height": "240px",
        "padding-top": "20vh",
      }}
    >
      <div class="text-14-regular text-text-weak">加载中…</div>
    </div>
  )
}

export function DocumentViewer(props: {
  kind: MediaKind
  value: unknown
  path?: string
  loadBinary?: () => Promise<Uint8Array | undefined>
  onLoad?: () => void
  onError?: () => void
  fallback: () => JSX.Element
}): JSX.Element {
  return (
    <Switch fallback={props.fallback()}>
      <Match when={props.kind === "pdf"}>
        <Suspense fallback={<CenteredLoading />}>
          <PdfViewer
            value={props.value}
            loadBinary={props.loadBinary}
            onLoad={props.onLoad}
            onError={props.onError}
            fallback={props.fallback}
          />
        </Suspense>
      </Match>
    </Switch>
  )
}
