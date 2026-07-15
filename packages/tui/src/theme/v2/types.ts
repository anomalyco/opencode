import type { RGBA } from "@opentui/core"
import type {
  ActionState,
  ActionVariant,
  BaseHue,
  FeedbackKind,
  FormfieldState,
  HueAlias,
  HueStep,
  MarkdownToken,
  ContextKey,
  SyntaxToken,
} from "./schema"

export type ResolvedActionState = "default" | ActionState
export type ResolvedFormfieldState = "default" | FormfieldState
export type HueScale = Readonly<Record<HueStep, RGBA>>
export type Hue = Readonly<Record<BaseHue | HueAlias, HueScale>>
export type StatefulColor = Readonly<Record<ResolvedActionState, RGBA>>
export type FormfieldColor = Readonly<Record<ResolvedFormfieldState, RGBA>>

export type ResolvedThemeView = {
  readonly hue: Hue
  readonly text: {
    readonly default: RGBA
    readonly subdued: RGBA
    readonly action: Readonly<Record<ActionVariant, StatefulColor>>
    readonly formfield: FormfieldColor
    readonly feedback: Readonly<Record<FeedbackKind, { readonly default: RGBA; readonly subdued: RGBA }>>
  }
  readonly background: {
    readonly default: RGBA
    readonly surface: {
      readonly offset: RGBA
      readonly overlay: RGBA
    }
    readonly action: Readonly<Record<ActionVariant, StatefulColor>>
    readonly formfield: FormfieldColor
    readonly feedback: Readonly<Record<FeedbackKind, { readonly default: RGBA }>>
  }
  readonly border: { readonly default: RGBA }
  readonly scrollbar: { readonly default: RGBA }
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

export type ResolvedTheme = ResolvedThemeView & {
  readonly contexts: Readonly<Partial<Record<ContextKey, ResolvedThemeView>>>
}
