export type NonEmpty<A> = readonly [A, ...ReadonlyArray<A>]
export type OneOrMany<A> = A | NonEmpty<A>

export const ScreenCategories = ["system", "navigation", "picker", "status", "information", "session"] as const
export type ScreenCategory = (typeof ScreenCategories)[number]

export const Surfaces = ["full-screen", "modal", "inline", "panel", "toast"] as const
export type Surface = (typeof Surfaces)[number]

export const Patterns = [
  "landing",
  "palette",
  "picker",
  "list",
  "status",
  "info",
  "pairing",
  "approval",
  "form",
  "terminal",
  "notification",
  "error-report",
  "navigation",
] as const
export type Pattern = (typeof Patterns)[number]

export const States = [
  "default",
  "empty",
  "populated",
  "pending",
  "idle",
  "running",
  "streaming",
  "selected",
  "expanded",
  "confirmation",
  "success",
  "error",
] as const
export type ScreenState = (typeof States)[number]

export type TaxonomyDefinition = Readonly<
  Record<
    string,
    {
      readonly label: string
      readonly items: Readonly<Record<string, string>>
    }
  >
>

type ValueOf<T> = T[keyof T]
export type TaxonomyItemId<T extends TaxonomyDefinition> =
  ValueOf<T> extends infer Group
    ? Group extends { readonly items: infer Items extends Readonly<Record<string, string>> }
      ? Extract<keyof Items, string>
      : never
    : never

export interface Taxonomies<ScreenLabels extends TaxonomyDefinition, UiElements extends TaxonomyDefinition> {
  readonly screenLabels: ScreenLabels
  readonly uiElements: UiElements
}

export interface ScreenDefinition<ScreenLabel extends string, UiElement extends string> {
  readonly title: string
  readonly category: ScreenCategory
  readonly screenLabels: NonEmpty<ScreenLabel>
  readonly uiElements: NonEmpty<UiElement>
  readonly surfaces: OneOrMany<Surface>
  readonly patterns: OneOrMany<Pattern>
  readonly features: OneOrMany<string>
  readonly states: OneOrMany<ScreenState>
}

export type ScreenDefinitions<ScreenLabel extends string, UiElement extends string> = Readonly<
  Record<string, ScreenDefinition<ScreenLabel, UiElement>>
>

export type ScreenId<Screens extends ScreenDefinitions<string, string>> = Extract<keyof Screens, string>

export interface FlowStepDefinition<CaptureId extends string> {
  readonly capture: CaptureId
  readonly title: string
  readonly trigger?: string
  readonly description?: string
}

export interface FlowDefinition<CaptureId extends string> {
  readonly title: string
  readonly description: string
  readonly replayable?: boolean
  readonly steps: NonEmpty<FlowStepDefinition<CaptureId>>
}

export type FlowGroupDefinitions<CaptureId extends string> = Readonly<
  Record<
    string,
    {
      readonly label: string
      readonly flows: Readonly<Record<string, FlowDefinition<CaptureId>>>
    }
  >
>

export interface CatalogDefinition {
  readonly taxonomies: Taxonomies<TaxonomyDefinition, TaxonomyDefinition>
  readonly screens: ScreenDefinitions<string, string>
  readonly flowGroups: FlowGroupDefinitions<string>
}

export function defineTaxonomies<
  const ScreenLabels extends TaxonomyDefinition,
  const UiElements extends TaxonomyDefinition,
>(definitions: {
  readonly screenLabels: ScreenLabels
  readonly uiElements: UiElements
}): Taxonomies<ScreenLabels, UiElements> {
  return definitions
}

export function defineScreens<
  ScreenLabels extends TaxonomyDefinition,
  UiElements extends TaxonomyDefinition,
  const Definitions extends ScreenDefinitions<string, string>,
>(
  taxonomies: Taxonomies<ScreenLabels, UiElements>,
  definitions: Definitions & ScreenDefinitions<TaxonomyItemId<ScreenLabels>, TaxonomyItemId<UiElements>>,
): Definitions {
  return definitions
}

export function defineFlows<
  Screens extends ScreenDefinitions<string, string>,
  const Definitions extends FlowGroupDefinitions<string>,
>(screens: Screens, definitions: Definitions & FlowGroupDefinitions<ScreenId<Screens>>): Definitions {
  return definitions
}
