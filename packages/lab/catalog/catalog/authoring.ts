import { Effect } from "effect"
import {
  Catalog,
  CatalogBuildError,
  type CatalogIssue,
  type DriveManifest,
} from "./schema"
import type {
  CatalogDefinition,
  FlowStepDefinition,
  NonEmpty,
  OneOrMany,
  TaxonomyDefinition,
} from "./dsl"

export const compileCatalog = Effect.fn("Catalog.compile")(function*(
  definition: CatalogDefinition,
  manifest: DriveManifest,
) {
  const issues = collectIssues(definition, manifest)
  const first = issues[0]
  if (first) {
    return yield* new CatalogBuildError({ issues: [first, ...issues.slice(1)] })
  }

  const screenTaxonomy = normalizeTaxonomy(definition.taxonomies.screenLabels)
  const uiElementTaxonomy = normalizeTaxonomy(definition.taxonomies.uiElements)
  const screens = manifest.captures.map((capture) => {
    const authored = definition.screens[capture.id]
    if (!authored) throw new Error(`Validated screen definition missing for ${capture.id}`)
    const firstFrame = capture.frames[0]
    const surfaces = normalize(authored.surfaces)
    const patterns = normalize(authored.patterns)
    const features = normalize(authored.features)
    const states = normalize(authored.states)
    return {
      id: capture.id,
      title: authored.title,
      category: authored.category,
      summary: "",
      tags: [
        ...authored.screenLabels,
        ...authored.uiElements,
        ...surfaces,
        ...patterns,
        ...features,
        ...states,
      ],
      screenLabels: authored.screenLabels,
      uiElements: authored.uiElements,
      surfaces,
      patterns,
      features,
      states,
      dimensions: [] as const,
      viewport: { cols: firstFrame.cols, rows: firstFrame.rows },
      variations: [] as const,
      frames: capture.frames,
    }
  })
  const flows = Object.entries(definition.flowGroups).flatMap(([, group]) =>
    Object.entries(group.flows).map(([id, flow]) => {
      const [first, ...rest] = flow.steps
      const steps: NonEmpty<ReturnType<typeof normalizeFlowStep>> = [
        normalizeFlowStep(first),
        ...rest.map(normalizeFlowStep),
      ]
      return {
        id,
        title: flow.title,
        group: group.label,
        description: flow.description,
        replayable: flow.replayable ?? false,
        steps,
      }
    }),
  )

  return yield* Catalog.makeEffect({
    format: "opencode-terminal-catalog-v3",
    generatedBy: manifest.generatedBy,
    variants: manifest.variants,
    screenTaxonomy,
    uiElementTaxonomy,
    surfaces: facetValues(screens, (screen) => screen.surfaces),
    patterns: facetValues(screens, (screen) => screen.patterns),
    features: facetValues(screens, (screen) => screen.features),
    states: facetValues(screens, (screen) => screen.states),
    screens,
    flows,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CatalogBuildError({
          issues: [{ path: "catalog", message: cause.toString() }],
        }),
    ),
  )
})

function normalize<A extends string>(value: OneOrMany<A>): ReadonlyArray<A> {
  return typeof value === "string" ? [value] : value
}

function normalizeFlowStep(step: FlowStepDefinition<string>) {
  return {
    screenId: step.capture,
    title: step.title,
    ...(step.trigger === undefined ? {} : { trigger: step.trigger }),
    ...(step.description === undefined ? {} : { description: step.description }),
  }
}

function normalizeTaxonomy(definition: TaxonomyDefinition) {
  return Object.entries(definition).map(([id, group]) => ({
    id,
    label: group.label,
    items: Object.entries(group.items).map(([itemId, label]) => ({ id: itemId, label })),
  }))
}

function facetValues<Screen, Value extends string>(
  screens: ReadonlyArray<Screen>,
  select: (screen: Screen) => ReadonlyArray<Value>,
) {
  return Array.from(new Set(screens.flatMap(select))).sort()
}

function collectIssues(definition: CatalogDefinition, manifest: DriveManifest): Array<CatalogIssue> {
  const issues: Array<CatalogIssue> = []
  const captureIds = manifest.captures.map((capture) => capture.id)
  const variantIds = manifest.variants.map((variant) => variant.id)
  const captureIdSet = new Set(captureIds)
  const screenIds = Object.keys(definition.screens)
  const screenIdSet = new Set(screenIds)
  const screenLabelIds = taxonomyIds(definition.taxonomies.screenLabels, "screenLabels", issues)
  const uiElementIds = taxonomyIds(definition.taxonomies.uiElements, "uiElements", issues)

  duplicateIssues(captureIds, "drive-captures.json.captures", issues)
  duplicateIssues(variantIds, "drive-captures.json.variants", issues)

  for (const capture of manifest.captures) {
    const frameVariantIds = capture.frames.map((frame) => frame.variantId)
    duplicateIssues(frameVariantIds, `drive-captures.json.captures.${capture.id}.frames`, issues)
    for (const variantId of frameVariantIds) {
      if (!variantIds.includes(variantId)) {
        issues.push({
          path: `drive-captures.json.captures.${capture.id}.frames`,
          message: `Capture ${capture.id} references unknown variant ${variantId}`,
        })
      }
    }
    const screen = definition.screens[capture.id]
    if (!screen) {
      issues.push({
        path: `screens.${capture.id}`,
        message: `Capture ${capture.id} has no authored screen definition`,
      })
      continue
    }
  }

  for (const screenId of screenIds) {
    if (!captureIdSet.has(screenId)) {
      issues.push({ path: `screens.${screenId}`, message: `Authored screen ${screenId} has no capture` })
    }
    const screen = definition.screens[screenId]
    if (!screen) continue
    referenceIssues(screen.screenLabels, screenLabelIds, `screens.${screenId}.screenLabels`, issues)
    referenceIssues(screen.uiElements, uiElementIds, `screens.${screenId}.uiElements`, issues)
    duplicateIssues(screen.screenLabels, `screens.${screenId}.screenLabels`, issues)
    duplicateIssues(screen.uiElements, `screens.${screenId}.uiElements`, issues)
    duplicateIssues(normalize(screen.surfaces), `screens.${screenId}.surfaces`, issues)
    duplicateIssues(normalize(screen.patterns), `screens.${screenId}.patterns`, issues)
    duplicateIssues(normalize(screen.features), `screens.${screenId}.features`, issues)
    duplicateIssues(normalize(screen.states), `screens.${screenId}.states`, issues)
  }

  const flowIds: Array<string> = []
  for (const [groupId, group] of Object.entries(definition.flowGroups)) {
    for (const [flowId, flow] of Object.entries(group.flows)) {
      flowIds.push(flowId)
      if (flow.steps.length === 0) {
        issues.push({ path: `flowGroups.${groupId}.${flowId}.steps`, message: `Flow ${flowId} has no steps` })
      }
      for (const [index, step] of flow.steps.entries()) {
        if (!screenIdSet.has(step.capture)) {
          issues.push({
            path: `flowGroups.${groupId}.${flowId}.steps.${index}.capture`,
            message: `Flow ${flowId} references unknown capture ${step.capture}`,
          })
        }
      }
    }
  }
  duplicateIssues(flowIds, "flowGroups", issues)
  return issues
}

function taxonomyIds(
  taxonomy: TaxonomyDefinition,
  path: string,
  issues: Array<CatalogIssue>,
): ReadonlySet<string> {
  const ids = Object.values(taxonomy).flatMap((group) => Object.keys(group.items))
  duplicateIssues(ids, path, issues)
  return new Set(ids)
}

function duplicateIssues(values: ReadonlyArray<string>, path: string, issues: Array<CatalogIssue>) {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) issues.push({ path, message: `Duplicate value ${value}` })
    seen.add(value)
  }
}

function referenceIssues(
  values: ReadonlyArray<string>,
  known: ReadonlySet<string>,
  path: string,
  issues: Array<CatalogIssue>,
) {
  for (const value of values) {
    if (!known.has(value)) issues.push({ path, message: `Unknown reference ${value}` })
  }
}
