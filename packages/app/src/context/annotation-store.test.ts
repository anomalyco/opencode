import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

let createAnnotationStoreForTest: typeof import("./annotation-store").createAnnotationStoreForTest

beforeAll(async () => {
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: () => ({
      use: () => undefined,
      provider: () => undefined,
    }),
  }))
  const mod = await import("./annotation-store")
  createAnnotationStoreForTest = mod.createAnnotationStoreForTest
})

describe("annotation store", () => {
  test("tracks inspect mode and pending selections", () => {
    createRoot((dispose) => {
      const annotations = createAnnotationStoreForTest()

      annotations.startInspectMode()
      expect(annotations.store.inspectMode).toBe(true)

      annotations.setPendingAnnotation({
        pageTitle: "Checkout",
        pageUrl: "https://opencode.ai/checkout",
        element: {
          selector: "button.buy-now",
          tagName: "button",
          role: "button",
          accessibleName: "Buy now",
          visibleText: "Buy now",
          attributes: { role: "button" },
          boundingBox: { x: 12, y: 24, width: 120, height: 32 },
          nearbyDomSanitized: "Buy now Secure checkout",
        },
      })

      expect(annotations.store.inspectMode).toBe(true)
      expect(annotations.store.pendingAnnotation?.element.selector).toBe("button.buy-now")

      dispose()
    })
  })

  test("confirms pending annotations into persisted entries", () => {
    createRoot((dispose) => {
      const now = Date.now()
      const annotations = createAnnotationStoreForTest()
      annotations.startInspectMode()

      annotations.setPendingAnnotation({
        pageTitle: "Checkout",
        pageUrl: "https://opencode.ai/checkout",
        element: {
          selector: "button.buy-now",
          tagName: "button",
          role: "button",
          accessibleName: "Buy now",
          visibleText: "Buy now",
          attributes: { role: "button", "data-testid": "buy-now" },
          boundingBox: { x: 12, y: 24, width: 120, height: 32 },
          nearbyDomSanitized: "Buy now Secure checkout",
        },
      })

      const createdId = annotations.confirmPendingAnnotation("Primary CTA is misleading", now)

      expect(createdId).toBeString()
      expect(annotations.store.pendingAnnotation).toBeNull()
      expect(annotations.store.annotations).toHaveLength(1)
      expect(annotations.store.annotations[0]).toMatchObject({
        id: createdId,
        createdAt: now,
        pageTitle: "Checkout",
        pageUrl: "https://opencode.ai/checkout",
        userComment: "Primary CTA is misleading",
        element: {
          selector: "button.buy-now",
          role: "button",
        },
        context: {
          nearbyDomSanitized: "Buy now Secure checkout",
        },
      })

      dispose()
    })
  })

  test("stores completed inspect results returned from the desktop page overlay", () => {
    createRoot((dispose) => {
      const now = Date.now()
      const annotations = createAnnotationStoreForTest()
      annotations.startInspectMode()

      const createdId = annotations.addAnnotationFromInspectResult(
        {
          annotation: {
            selector: "button.buy-now",
            tagName: "button",
            role: "button",
            accessibleName: "Buy now",
            visibleText: "Buy now",
            attributes: { role: "button", "data-testid": "buy-now" },
            boundingBox: { x: 12, y: 24, width: 120, height: 32 },
            nearbyDomSanitized: "Buy now Secure checkout",
            xpath: "/html/body/button[1]",
          },
          context: {
            accessibilitySnapshotNearby: { role: "button" },
            nearbyDomSanitized: "Checkout summary",
          },
          pageTitle: "Checkout",
          pageUrl: "https://opencode.ai/checkout",
          preview: {
            screenshotCrop: "data:image/png;base64,AAA",
            viewportScreenshotId: "browser-screenshot-1",
          },
          userComment: "Primary CTA is misleading",
        },
        now,
      )

      expect(createdId).toBeString()
      expect(annotations.store.inspectMode).toBe(true)
      expect(annotations.store.annotations).toHaveLength(1)
      expect(annotations.store.annotations[0]).toMatchObject({
        id: createdId,
        createdAt: now,
        pageTitle: "Checkout",
        pageUrl: "https://opencode.ai/checkout",
        userComment: "Primary CTA is misleading",
        element: {
          selector: "button.buy-now",
          xpath: "/html/body/button[1]",
        },
        context: {
          accessibilitySnapshotNearby: { role: "button" },
          nearbyDomSanitized: "Checkout summary",
        },
        preview: {
          screenshotCrop: "data:image/png;base64,AAA",
          viewportScreenshotId: "browser-screenshot-1",
        },
      })

      dispose()
    })
  })

  test("clears pending selection and annotations independently", () => {
    createRoot((dispose) => {
      const annotations = createAnnotationStoreForTest({
        annotations: [
          {
            id: "annotation-1",
            createdAt: 1,
            pageTitle: "Checkout",
            pageUrl: "https://opencode.ai/checkout",
            userComment: "Existing note",
            element: {
              selector: "button.buy-now",
              tagName: "button",
              role: "button",
              accessibleName: "Buy now",
              visibleText: "Buy now",
              attributes: {},
              boundingBox: { x: 1, y: 2, width: 3, height: 4 },
            },
            preview: {},
            context: {},
          },
        ],
      })

      annotations.setPendingAnnotation({
        pageTitle: "Checkout",
        pageUrl: "https://opencode.ai/checkout",
        element: {
          selector: "button.buy-now",
          tagName: "button",
          attributes: {},
          boundingBox: { x: 12, y: 24, width: 120, height: 32 },
          nearbyDomSanitized: "Buy now Secure checkout",
        },
      })

      annotations.cancelPendingAnnotation()
      expect(annotations.store.pendingAnnotation).toBeNull()
      expect(annotations.store.annotations).toHaveLength(1)

      annotations.clearAnnotations()
      expect(annotations.store.annotations).toEqual([])

      dispose()
    })
  })

  test("merges on-demand annotation detail into an existing annotation", () => {
    createRoot((dispose) => {
      const annotations = createAnnotationStoreForTest({
        annotations: [
          {
            id: "annotation-1",
            createdAt: 1,
            pageTitle: "Checkout",
            pageUrl: "https://opencode.ai/checkout",
            userComment: "Existing note",
            element: {
              selector: "button.buy-now",
              tagName: "button",
              role: "button",
              accessibleName: "Buy now",
              visibleText: "Buy now",
              attributes: {},
              boundingBox: { x: 1, y: 2, width: 3, height: 4 },
            },
            preview: {},
            context: {},
          },
        ],
      })

      annotations.mergeAnnotationDetail("annotation-1", {
        preview: {
          screenshotCrop: "data:image/png;base64,AAA",
        },
        context: {
          accessibilitySnapshotNearby: { role: "button" },
          nearbyDomSanitized: "Buy now Secure checkout",
        },
      })

      expect(annotations.getAnnotation("annotation-1")).toMatchObject({
        preview: {
          screenshotCrop: "data:image/png;base64,AAA",
        },
        context: {
          accessibilitySnapshotNearby: { role: "button" },
          nearbyDomSanitized: "Buy now Secure checkout",
        },
      })

      dispose()
    })
  })
})
