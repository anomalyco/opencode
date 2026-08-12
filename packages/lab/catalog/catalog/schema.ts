import { Schema } from "effect"
import { Frontend } from "opencode-drive/client"
import { Patterns, ScreenCategories, States, Surfaces } from "./dsl"

const Slug = Schema.NonEmptyString.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
const CapturePath = Schema.String.check(
  Schema.isPattern(/^captures\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\.frame\.json$/),
)
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const ScreenCategory = Schema.Literals(ScreenCategories)
const Surface = Schema.Literals(Surfaces)
const Pattern = Schema.Literals(Patterns)
const ScreenState = Schema.Literals(States)

export const Variant = Schema.Struct({
  id: Slug,
  label: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  revision: Schema.NonEmptyString,
  ref: Schema.NonEmptyString,
  committedAt: Schema.NonEmptyString,
  theme: Schema.optionalKey(Schema.NonEmptyString),
})

export interface Variant extends Schema.Schema.Type<typeof Variant> {}

export const Frame = Schema.Struct({
  variantId: Slug,
  src: CapturePath,
  cols: PositiveInt,
  rows: PositiveInt,
})

export interface Frame extends Schema.Schema.Type<typeof Frame> {}

export const DriveCapture = Schema.Struct({
  id: Slug,
  title: Schema.NonEmptyString,
  category: ScreenCategory,
  frames: Schema.NonEmptyArray(Frame),
})

export interface DriveCapture extends Schema.Schema.Type<typeof DriveCapture> {}

export const DriveManifest = Schema.Struct({
  format: Schema.Literal("opencode-terminal-frame-captures-v1"),
  generatedBy: Schema.NonEmptyString,
  variants: Schema.NonEmptyArray(Variant),
  captures: Schema.Array(DriveCapture),
})

export interface DriveManifest extends Schema.Schema.Type<typeof DriveManifest> {}

export const TaxonomyItem = Schema.Struct({
  id: Slug,
  label: Schema.NonEmptyString,
})

export interface TaxonomyItem extends Schema.Schema.Type<typeof TaxonomyItem> {}

export const TaxonomyGroup = Schema.Struct({
  id: Slug,
  label: Schema.NonEmptyString,
  items: Schema.Array(TaxonomyItem),
})

export interface TaxonomyGroup extends Schema.Schema.Type<typeof TaxonomyGroup> {}

export const FlowStep = Schema.Struct({
  screenId: Slug,
  title: Schema.NonEmptyString,
  trigger: Schema.optionalKey(Schema.NonEmptyString),
  description: Schema.optionalKey(Schema.NonEmptyString),
})

export interface FlowStep extends Schema.Schema.Type<typeof FlowStep> {}

export const Flow = Schema.Struct({
  id: Slug,
  title: Schema.NonEmptyString,
  group: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  replayable: Schema.Boolean,
  steps: Schema.NonEmptyArray(FlowStep),
})

export interface Flow extends Schema.Schema.Type<typeof Flow> {}

export const FrameArtifact = Schema.Struct({
  format: Schema.Literal("opencode-terminal-frame-v1"),
  ...Frontend.CapturedFrame.fields,
  cols: PositiveInt,
  rows: PositiveInt,
})

export interface FrameArtifact extends Schema.Schema.Type<typeof FrameArtifact> {}

export const Screen = Schema.Struct({
  id: Slug,
  title: Schema.NonEmptyString,
  category: ScreenCategory,
  summary: Schema.String,
  tags: Schema.Array(Schema.NonEmptyString),
  screenLabels: Schema.Array(Schema.NonEmptyString),
  uiElements: Schema.Array(Schema.NonEmptyString),
  surfaces: Schema.Array(Surface),
  patterns: Schema.Array(Pattern),
  features: Schema.Array(Schema.NonEmptyString),
  states: Schema.Array(ScreenState),
  dimensions: Schema.Tuple([]),
  viewport: Schema.Struct({ cols: PositiveInt, rows: PositiveInt }),
  variations: Schema.Tuple([]),
  frames: Schema.NonEmptyArray(Frame),
})

export interface Screen extends Schema.Schema.Type<typeof Screen> {}

export const Catalog = Schema.Struct({
  format: Schema.Literal("opencode-terminal-catalog-v3"),
  generatedBy: Schema.NonEmptyString,
  variants: Schema.NonEmptyArray(Variant),
  screenTaxonomy: Schema.Array(TaxonomyGroup),
  uiElementTaxonomy: Schema.Array(TaxonomyGroup),
  surfaces: Schema.Array(Surface),
  patterns: Schema.Array(Pattern),
  features: Schema.Array(Schema.NonEmptyString),
  states: Schema.Array(ScreenState),
  screens: Schema.Array(Screen),
  flows: Schema.Array(Flow),
})

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}

export const CatalogIssue = Schema.Struct({
  path: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
})

export interface CatalogIssue extends Schema.Schema.Type<typeof CatalogIssue> {}

export class CatalogBuildError extends Schema.TaggedErrorClass<CatalogBuildError>()(
  "CatalogBuildError",
  {
    issues: Schema.NonEmptyArray(CatalogIssue),
  },
) {}

export class CatalogBoundaryError extends Schema.TaggedErrorClass<CatalogBoundaryError>()(
  "CatalogBoundaryError",
  {
    boundary: Schema.NonEmptyString,
    cause: Schema.Defect(),
  },
) {}
