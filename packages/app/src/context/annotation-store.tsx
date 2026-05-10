import { createSimpleContext } from "@opencode-ai/ui/context"
import { batch } from "solid-js"
import { createStore } from "solid-js/store"
import { uuid } from "@/utils/uuid"
import type { BrowserAnnotation, BrowserAnnotationData, BrowserInspectResult } from "@/context/browser-types"

type PendingAnnotation = {
  pageUrl: string
  pageTitle: string
  element: BrowserAnnotationData
  preview?: BrowserAnnotation["preview"]
}

type AnnotationStore = {
  annotations: BrowserAnnotation[]
  inspectMode: boolean
  panelOpen: boolean
  pendingAnnotation: PendingAnnotation | null
}

type AnnotationDetail = Partial<Pick<BrowserAnnotation, "preview" | "context">> & {
  element?: Partial<BrowserAnnotation["element"]>
}

function createAnnotationStore(initial?: Partial<AnnotationStore>) {
  const [store, setStore] = createStore<AnnotationStore>({
    annotations: initial?.annotations ?? [],
    inspectMode: initial?.inspectMode ?? false,
    panelOpen: initial?.panelOpen ?? false,
    pendingAnnotation: initial?.pendingAnnotation ?? null,
  })

  return {
    store,
    setPanelOpen(open: boolean) {
      setStore("panelOpen", open)
    },
    startInspectMode() {
      batch(() => {
        setStore("inspectMode", true)
        setStore("pendingAnnotation", null)
      })
    },
    stopInspectMode() {
      setStore("inspectMode", false)
    },
    setPendingAnnotation(annotation: PendingAnnotation | null) {
      setStore("pendingAnnotation", annotation)
    },
    cancelPendingAnnotation() {
      setStore("pendingAnnotation", null)
    },
    confirmPendingAnnotation(comment: string, createdAt = Date.now()) {
      const pending = store.pendingAnnotation
      const userComment = comment.trim()
      if (!pending || !userComment) return

      const id = uuid()
      const annotation: BrowserAnnotation = {
        id,
        createdAt,
        pageUrl: pending.pageUrl,
        pageTitle: pending.pageTitle,
        userComment,
        element: {
          tagName: pending.element.tagName,
          role: pending.element.role,
          accessibleName: pending.element.accessibleName,
          visibleText: pending.element.visibleText,
          attributes: pending.element.attributes,
          selector: pending.element.selector,
          xpath: pending.element.xpath,
          boundingBox: pending.element.boundingBox,
        },
        preview: pending.preview ?? {},
        context: {
          nearbyDomSanitized: pending.element.nearbyDomSanitized,
        },
      }

      batch(() => {
        setStore("annotations", (items) => [...items, annotation])
        setStore("pendingAnnotation", null)
      })

      return id
    },
    addAnnotationFromInspectResult(result: BrowserInspectResult, createdAt = Date.now()) {
      const userComment = result.userComment.trim()
      if (!userComment) return

      const id = uuid()
      const annotation: BrowserAnnotation = {
        id,
        createdAt,
        pageUrl: result.pageUrl,
        pageTitle: result.pageTitle,
        userComment,
        element: {
          tagName: result.annotation.tagName,
          role: result.annotation.role,
          accessibleName: result.annotation.accessibleName,
          visibleText: result.annotation.visibleText,
          attributes: result.annotation.attributes,
          selector: result.annotation.selector,
          xpath: result.annotation.xpath,
          boundingBox: result.annotation.boundingBox,
        },
        preview: result.preview ?? {},
        context: {
          nearbyDomSanitized: result.context?.nearbyDomSanitized ?? result.annotation.nearbyDomSanitized,
          accessibilitySnapshotNearby: result.context?.accessibilitySnapshotNearby,
        },
      }

      batch(() => {
        setStore("pendingAnnotation", null)
        setStore("annotations", (items) => [...items, annotation])
      })

      return id
    },
    getAnnotation(id: string) {
      return store.annotations.find((item) => item.id === id)
    },
    mergeAnnotationDetail(id: string, detail: AnnotationDetail) {
      setStore("annotations", (items) =>
        items.map((annotation) => {
          if (annotation.id !== id) return annotation
          return {
            ...annotation,
            element: detail.element ? { ...annotation.element, ...detail.element } : annotation.element,
            preview: detail.preview ? { ...annotation.preview, ...detail.preview } : annotation.preview,
            context: detail.context ? { ...annotation.context, ...detail.context } : annotation.context,
          }
        }),
      )
    },
    removeAnnotation(id: string) {
      setStore("annotations", (items) => items.filter((item) => item.id !== id))
    },
    clearAnnotations() {
      setStore("annotations", [])
    },
  }
}

export function createAnnotationStoreForTest(initial?: Partial<AnnotationStore>) {
  return createAnnotationStore(initial)
}

export const { use: useAnnotationStore, provider: AnnotationProvider } = createSimpleContext({
  name: "Annotation",
  gate: false,
  init: () => createAnnotationStore(),
})
