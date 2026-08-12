import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import "./authoring.typecheck"
import { compileCatalog } from "./authoring"
import type { CatalogDefinition, ScreenDefinition } from "./dsl"
import type { DriveManifest } from "./schema"

const manifest: DriveManifest = {
  format: "opencode-terminal-frame-captures-v1",
  generatedBy: "scripts/capture-opencode-drive.ts",
  variants: [{
    id: "baseline",
    label: "Baseline",
    source: "/tmp/opencode",
    revision: "abc123",
    ref: "v2",
    committedAt: "2026-07-17T10:17:51Z",
    theme: "opencode",
  }],
  captures: [
    {
      id: "home",
      title: "Home",
      category: "system",
      frames: [{
        variantId: "baseline",
        src: "captures/baseline/home.frame.json",
        cols: 118,
        rows: 34,
      }],
    },
  ],
}

const homeDefinition = {
  title: "Home",
  category: "system",
  screenLabels: ["start-screen"],
  uiElements: ["full-screen-view"],
  surfaces: "full-screen",
  patterns: "landing",
  features: "session",
  states: "empty",
} satisfies ScreenDefinition<string, string>

const definition: CatalogDefinition = {
  taxonomies: {
    screenLabels: {
      "getting-started": {
        label: "Getting started",
        items: { "start-screen": "Start screen" },
      },
    },
    uiElements: {
      containers: {
        label: "Containers",
        items: { "full-screen-view": "Full-screen view" },
      },
    },
  },
  screens: {
    home: homeDefinition,
  },
  flowGroups: {
    "getting-started": {
      label: "Getting started",
      flows: {
        "starting-a-session": {
          title: "Starting a session",
          description: "Begin a new conversation.",
          steps: [{ capture: "home", title: "Open OpenCode" }],
        },
      },
    },
  },
}

describe("catalog authoring", () => {
  test("compiles authored records into the runtime catalog", async () => {
    const catalog = await Effect.runPromise(compileCatalog(definition, manifest))

    expect(catalog.screenTaxonomy[0]).toEqual({
      id: "getting-started",
      label: "Getting started",
      items: [{ id: "start-screen", label: "Start screen" }],
    })
    expect(catalog.screens[0]?.tags).toEqual([
      "start-screen",
      "full-screen-view",
      "full-screen",
      "landing",
      "session",
      "empty",
    ])
    expect(catalog.flows[0]?.steps[0]?.screenId).toBe("home")
  })

  test("uses authored display metadata without requiring a recapture", async () => {
    const catalog = await Effect.runPromise(
      compileCatalog(
        {
          ...definition,
          screens: {
            home: { ...homeDefinition, title: "Start screen" },
          },
        },
        manifest,
      ),
    )

    expect(catalog.screens[0]?.title).toBe("Start screen")
  })

  test("allows older capture sets to omit screens introduced later", async () => {
    const catalog = await Effect.runPromise(
      compileCatalog(definition, {
        ...manifest,
        variants: [
          manifest.variants[0],
          {
            id: "older",
            label: "Older",
            source: "/tmp/opencode",
            revision: "def456",
            ref: "v2~1",
            committedAt: "2026-07-16T10:17:51Z",
          },
        ],
      }),
    )

    expect(catalog.screens[0]?.frames.map((frame) => frame.variantId)).toEqual(["baseline"])
  })

  test("rejects frames for unknown capture sets", async () => {
    const error = await Effect.runPromise(
      compileCatalog(definition, {
        ...manifest,
        captures: [{
          id: "home",
          title: "Home",
          category: "system",
          frames: [{
            variantId: "unknown",
            src: "captures/unknown/home.frame.json",
            cols: 118,
            rows: 34,
          }],
        }],
      }).pipe(Effect.flip),
    )

    expect(error._tag).toBe("CatalogBuildError")
    if (error._tag !== "CatalogBuildError") return
    expect(error.issues).toContainEqual({
      path: "drive-captures.json.captures.home.frames",
      message: "Capture home references unknown variant unknown",
    })
  })

  test("reports every missing and orphaned capture together", async () => {
    const error = await Effect.runPromise(
      compileCatalog(
        {
          ...definition,
          screens: {
            orphan: homeDefinition,
          },
        },
        manifest,
      ).pipe(Effect.flip),
    )

    expect(error._tag).toBe("CatalogBuildError")
    if (error._tag !== "CatalogBuildError") return
    expect(error.issues.map((issue) => issue.message)).toEqual([
      "Capture home has no authored screen definition",
      "Authored screen orphan has no capture",
      "Flow starting-a-session references unknown capture home",
    ])
  })

  test("rejects taxonomy IDs repeated across groups", async () => {
    const error = await Effect.runPromise(
      compileCatalog(
        {
          ...definition,
          taxonomies: {
            ...definition.taxonomies,
            screenLabels: {
              first: { label: "First", items: { repeated: "Repeated" } },
              second: { label: "Second", items: { repeated: "Repeated again" } },
            },
          },
          screens: {
            home: {
              ...homeDefinition,
              screenLabels: ["repeated"],
            },
          },
        },
        manifest,
      ).pipe(Effect.flip),
    )

    expect(error._tag).toBe("CatalogBuildError")
    if (error._tag !== "CatalogBuildError") return
    expect(error.issues).toContainEqual({
      path: "screenLabels",
      message: "Duplicate value repeated",
    })
  })

  test("reports invalid authored values as build errors", async () => {
    const error = await Effect.runPromise(
      compileCatalog(
        {
          ...definition,
          taxonomies: {
            ...definition.taxonomies,
            screenLabels: {
              "getting-started": {
                label: "",
                items: { "start-screen": "Start screen" },
              },
            },
          },
        },
        manifest,
      ).pipe(Effect.flip),
    )

    expect(error._tag).toBe("CatalogBuildError")
    if (error._tag !== "CatalogBuildError") return
    expect(error.issues[0]?.path).toBe("catalog")
  })

  test("rejects flow IDs repeated across groups", async () => {
    const repeatedFlow = {
      title: "Starting a session",
      description: "Begin a new conversation.",
      steps: [{ capture: "home", title: "Open OpenCode" }],
    } as const
    const error = await Effect.runPromise(
      compileCatalog(
        {
          ...definition,
          flowGroups: {
            first: { label: "First", flows: { repeated: repeatedFlow } },
            second: { label: "Second", flows: { repeated: repeatedFlow } },
          },
        },
        manifest,
      ).pipe(Effect.flip),
    )

    expect(error._tag).toBe("CatalogBuildError")
    if (error._tag !== "CatalogBuildError") return
    expect(error.issues).toContainEqual({
      path: "flowGroups",
      message: "Duplicate value repeated",
    })
  })
})
