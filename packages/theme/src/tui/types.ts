import type { RGBA } from "@opentui/core"
import type {
  ActionState,
  ActionVariant,
  FeedbackKind,
  HueStep,
  MarkdownToken,
  SemanticHue,
  SurfaceName,
  SyntaxToken,
} from "./schema.js"

export type ResolvedActionState = "base" | ActionState
export type ResolvedFormfieldState = ResolvedActionState
export type HueScale = Readonly<Record<HueStep, RGBA>>
export type Hue = Readonly<Record<string, HueScale> & Record<SemanticHue, HueScale>>
export type HueSource = Readonly<{ hue: string; step: HueStep }>
export type Categorical = readonly HueScale[]
export type ActionStates = Readonly<Partial<Record<ActionState, boolean>>>
export type StatefulColor = Readonly<Record<ResolvedActionState, RGBA>> & {
  readonly state: (states: ActionStates) => RGBA
}
export type FormfieldColor = StatefulColor

export type ResolvedThemeTokens = {
  readonly hue: Hue
  readonly categorical: Categorical
  readonly source: (color: RGBA) => HueSource | undefined
  readonly increase: (color: RGBA, amount?: number) => RGBA
  readonly decrease: (color: RGBA, amount?: number) => RGBA
  readonly text: {
    readonly base: RGBA
    readonly muted: RGBA
    readonly action: Readonly<Record<ActionVariant, StatefulColor>>
    readonly formfield: FormfieldColor
    readonly feedback: Readonly<Record<FeedbackKind, { readonly base: RGBA; readonly muted: RGBA }>>
  }
  readonly background: {
    readonly base: RGBA
    readonly raised: {
      readonly base: RGBA
      readonly high: RGBA
      readonly max: RGBA
    }
    readonly action: Readonly<Record<ActionVariant, StatefulColor>>
    readonly formfield: FormfieldColor
    readonly feedback: Readonly<Record<FeedbackKind, { readonly base: RGBA }>>
  }
  readonly border: { readonly base: RGBA }
  readonly scrollbar: { readonly base: RGBA }
  readonly diff: {
    readonly text: {
      readonly added: RGBA
      readonly removed: RGBA
      readonly context: RGBA
      readonly hunkHeader: RGBA
    }
    readonly background: { readonly added: RGBA; readonly removed: RGBA; readonly context: RGBA }
    readonly highlight: { readonly added: RGBA; readonly removed: RGBA }
    readonly lineNumber: {
      readonly text: RGBA
      readonly background: { readonly added: RGBA; readonly removed: RGBA }
    }
  }
  readonly syntax: Readonly<Record<SyntaxToken, RGBA>>
  readonly markdown: Readonly<Record<MarkdownToken, RGBA>>
}

export type ResolvedTheme = ResolvedThemeTokens & {
  /** The same theme re-resolved on a raised surface. Absolute: every view's surfaces are the base theme's. */
  readonly surface: (name: SurfaceName) => ResolvedTheme
}
