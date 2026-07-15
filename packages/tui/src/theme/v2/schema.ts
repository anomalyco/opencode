import { Schema } from "effect"

export const HueStep = Schema.Literals([100, 200, 300, 400, 500, 600, 700, 800, 900])
export type HueStep = Schema.Schema.Type<typeof HueStep>

export const BaseHue = Schema.Literals(["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple"])
export type BaseHue = Schema.Schema.Type<typeof BaseHue>

export const HueAlias = Schema.Literals(["accent", "neutral"])
export type HueAlias = Schema.Schema.Type<typeof HueAlias>

export const ActionVariant = Schema.Literals(["primary", "secondary", "destructive"])
export type ActionVariant = Schema.Schema.Type<typeof ActionVariant>

export const ActionState = Schema.Literals(["focused", "pressed", "disabled"])
export type ActionState = Schema.Schema.Type<typeof ActionState>
export type ActionStateKey = `$${ActionState}`

export const FormfieldState = Schema.Literals(["focused", "pressed", "disabled", "selected"])
export type FormfieldState = Schema.Schema.Type<typeof FormfieldState>
export type FormfieldStateKey = `$${FormfieldState}`

export const FeedbackKind = Schema.Literals(["error", "warning", "success", "info"])
export type FeedbackKind = Schema.Schema.Type<typeof FeedbackKind>

const Mode = Schema.Literals(["light", "dark"])
export type Mode = Schema.Schema.Type<typeof Mode>

const HexColor = Schema.String.check(Schema.isPattern(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i))

const ColorValue = Schema.Union([
  HexColor,
  Schema.Literal("transparent"),
  Schema.TemplateLiteral(["$", Schema.NonEmptyString]),
])

const HueName = Schema.Union([BaseHue, HueAlias])
const HueColorValue = Schema.Union([HexColor, Schema.TemplateLiteral(["$hue.", HueName, ".", HueStep])])

const ContextKey = Schema.Literals(["@context:elevated", "@context:overlay"])
export type ContextKey = Schema.Schema.Type<typeof ContextKey>

const HueScaleDefinition = Schema.Record(HueStep, HexColor)
const HueAliasDefinition = Schema.Union([Schema.TemplateLiteral(["$hue.", HueName]), HueScaleDefinition])

const HueDefinition = Schema.Struct({
  gray: HueScaleDefinition,
  red: HueScaleDefinition,
  orange: HueScaleDefinition,
  yellow: HueScaleDefinition,
  green: HueScaleDefinition,
  cyan: HueScaleDefinition,
  blue: HueScaleDefinition,
  purple: HueScaleDefinition,
  accent: HueAliasDefinition,
  neutral: HueAliasDefinition,
})
export type HueDefinition = Schema.Schema.Type<typeof HueDefinition>

const HueOverrideDefinition = Schema.Struct({
  gray: Schema.optional(HueScaleDefinition),
  red: Schema.optional(HueScaleDefinition),
  orange: Schema.optional(HueScaleDefinition),
  yellow: Schema.optional(HueScaleDefinition),
  green: Schema.optional(HueScaleDefinition),
  cyan: Schema.optional(HueScaleDefinition),
  blue: Schema.optional(HueScaleDefinition),
  purple: Schema.optional(HueScaleDefinition),
  accent: Schema.optional(HueAliasDefinition),
  neutral: Schema.optional(HueAliasDefinition),
})
export type HueOverrideDefinition = Schema.Schema.Type<typeof HueOverrideDefinition>

const StatefulColorDefinition = Schema.Struct({
  default: Schema.optional(ColorValue),
  $focused: Schema.optional(ColorValue),
  $pressed: Schema.optional(ColorValue),
  $disabled: Schema.optional(ColorValue),
})
export type StatefulColorDefinition = Schema.Schema.Type<typeof StatefulColorDefinition>

const FormfieldColorDefinition = Schema.Struct({
  default: Schema.optional(ColorValue),
  $focused: Schema.optional(ColorValue),
  $pressed: Schema.optional(ColorValue),
  $disabled: Schema.optional(ColorValue),
  $selected: Schema.optional(ColorValue),
})
export type FormfieldColorDefinition = Schema.Schema.Type<typeof FormfieldColorDefinition>

const ActionColorDefinition = Schema.Struct({
  primary: Schema.optional(StatefulColorDefinition),
  secondary: Schema.optional(StatefulColorDefinition),
  destructive: Schema.optional(StatefulColorDefinition),
})

const TextFeedbackDefinition = Schema.Struct({
  default: Schema.optional(ColorValue),
  subdued: Schema.optional(ColorValue),
})

const BackgroundFeedbackDefinition = Schema.Struct({
  default: Schema.optional(ColorValue),
})

const TextDefinition = Schema.Struct({
  default: Schema.optional(ColorValue),
  subdued: Schema.optional(ColorValue),
  action: Schema.optional(ActionColorDefinition),
  formfield: Schema.optional(FormfieldColorDefinition),
  feedback: Schema.optional(
    Schema.Struct({
      error: Schema.optional(TextFeedbackDefinition),
      warning: Schema.optional(TextFeedbackDefinition),
      success: Schema.optional(TextFeedbackDefinition),
      info: Schema.optional(TextFeedbackDefinition),
    }),
  ),
})
export type TextDefinition = Schema.Schema.Type<typeof TextDefinition>

const BackgroundDefinition = Schema.Struct({
  default: Schema.optional(ColorValue),
  surface: Schema.optional(
    Schema.Struct({
      offset: Schema.optional(ColorValue),
      overlay: Schema.optional(ColorValue),
    }),
  ),
  action: Schema.optional(ActionColorDefinition),
  formfield: Schema.optional(FormfieldColorDefinition),
  feedback: Schema.optional(
    Schema.Struct({
      error: Schema.optional(BackgroundFeedbackDefinition),
      warning: Schema.optional(BackgroundFeedbackDefinition),
      success: Schema.optional(BackgroundFeedbackDefinition),
      info: Schema.optional(BackgroundFeedbackDefinition),
    }),
  ),
})
export type BackgroundDefinition = Schema.Schema.Type<typeof BackgroundDefinition>

export const SyntaxToken = Schema.Literals([
  "comment", "keyword", "function", "variable", "string", "number", "type", "operator", "punctuation",
])
export type SyntaxToken = Schema.Schema.Type<typeof SyntaxToken>
export const SyntaxDefinition = Schema.Record(SyntaxToken, Schema.optionalKey(HueColorValue))
export type SyntaxDefinition = Schema.Schema.Type<typeof SyntaxDefinition>

export const MarkdownToken = Schema.Literals([
  "text", "heading", "link", "linkText", "code", "blockQuote", "emphasis", "strong", "horizontalRule", "listItem",
  "listEnumeration", "image", "imageText", "codeBlock",
])
export type MarkdownToken = Schema.Schema.Type<typeof MarkdownToken>
export const MarkdownDefinition = Schema.Record(MarkdownToken, Schema.optionalKey(HueColorValue))
export type MarkdownDefinition = Schema.Schema.Type<typeof MarkdownDefinition>

const DiffDefinition = Schema.Struct({
  text: Schema.optional(
    Schema.Struct({
      added: Schema.optional(ColorValue),
      removed: Schema.optional(ColorValue),
      context: Schema.optional(ColorValue),
      hunkHeader: Schema.optional(ColorValue),
    }),
  ),
  background: Schema.optional(
    Schema.Struct({
      added: Schema.optional(ColorValue),
      removed: Schema.optional(ColorValue),
      context: Schema.optional(ColorValue),
    }),
  ),
  highlight: Schema.optional(
    Schema.Struct({ added: Schema.optional(ColorValue), removed: Schema.optional(ColorValue) }),
  ),
  lineNumber: Schema.optional(
    Schema.Struct({
      text: Schema.optional(ColorValue),
      background: Schema.optional(
        Schema.Struct({ added: Schema.optional(ColorValue), removed: Schema.optional(ColorValue) }),
      ),
    }),
  ),
})
export type DiffDefinition = Schema.Schema.Type<typeof DiffDefinition>

const ThemeTokensDefinition = Schema.Struct({
  text: Schema.optional(TextDefinition),
  background: Schema.optional(BackgroundDefinition),
  border: Schema.optional(Schema.Struct({ default: Schema.optional(ColorValue) })),
  scrollbar: Schema.optional(Schema.Struct({ default: Schema.optional(ColorValue) })),
  diff: Schema.optional(DiffDefinition),
  syntax: Schema.optional(SyntaxDefinition),
  markdown: Schema.optional(MarkdownDefinition),
})
export type ThemeTokensDefinition = Schema.Schema.Type<typeof ThemeTokensDefinition>

const ThemeDefinitionFields = Schema.Struct({
  hue: HueDefinition,
  ...ThemeTokensDefinition.fields,
  "@context:elevated": Schema.optional(ThemeTokensDefinition),
  "@context:overlay": Schema.optional(ThemeTokensDefinition),
})
export const ThemeDefinition = ThemeDefinitionFields
export type ThemeDefinition = Schema.Schema.Type<typeof ThemeDefinition>

const FileThemeDefinition = Schema.Struct({
  hue: Schema.optional(HueOverrideDefinition),
  ...ThemeTokensDefinition.fields,
  "@context:elevated": Schema.optional(ThemeTokensDefinition),
  "@context:overlay": Schema.optional(ThemeTokensDefinition),
})
export type FileThemeDefinition = Schema.Schema.Type<typeof FileThemeDefinition>

const MergeModeDefinition = Schema.Struct({
  mergeMode: Schema.Literal(true),
  hue: Schema.optional(HueOverrideDefinition),
  ...ThemeTokensDefinition.fields,
  "@context:elevated": Schema.optional(ThemeTokensDefinition),
  "@context:overlay": Schema.optional(ThemeTokensDefinition),
})
export type MergeModeDefinition = Schema.Schema.Type<typeof MergeModeDefinition>
export const ModeDefinition = Schema.Union([FileThemeDefinition, MergeModeDefinition])
export type ModeDefinition = Schema.Schema.Type<typeof ModeDefinition>

const FileMetadata = {
  $schema: Schema.optional(Schema.String),
  version: Schema.Literal(2),
  standalone: Schema.optional(Schema.Boolean),
}
export const ThemeFile = Schema.Struct({ ...FileMetadata, light: ModeDefinition, dark: ModeDefinition })
export type ThemeFile = Schema.Schema.Type<typeof ThemeFile>
