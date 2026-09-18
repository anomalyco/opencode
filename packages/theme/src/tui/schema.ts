import { Schema } from "effect"

export const HueStep = Schema.Literals([100, 200, 300, 400, 500, 600, 700, 800, 900])
export type HueStep = Schema.Schema.Type<typeof HueStep>

export const BaseHue = Schema.Literals(["gray", "red", "orange", "yellow", "green", "cyan", "blue", "purple"])
export type BaseHue = Schema.Schema.Type<typeof BaseHue>

export const HueAlias = Schema.Literals(["accent", "interactive", "neutral"])
export type HueAlias = Schema.Schema.Type<typeof HueAlias>

export const ActionVariant = Schema.Literals(["primary", "secondary", "destructive"])
export type ActionVariant = Schema.Schema.Type<typeof ActionVariant>

export const ActionState = Schema.Literals(["disabled", "pressed", "focused", "selected", "hovered"])
export type ActionState = Schema.Schema.Type<typeof ActionState>
export type ActionStateKey = `$${ActionState}`

export const SurfaceName = Schema.Literal("dialog")
export type SurfaceName = Schema.Schema.Type<typeof SurfaceName>

export const FormfieldState = ActionState
export type FormfieldState = ActionState
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

export const HueName = Schema.Union([BaseHue, HueAlias])
export type HueName = Schema.Schema.Type<typeof HueName>
export const CategoricalDefinition = Schema.Array(HueName).check(Schema.isMinLength(1))
export type CategoricalDefinition = Schema.Schema.Type<typeof CategoricalDefinition>
const HueColorValue = Schema.Union([HexColor, Schema.TemplateLiteral(["$hue.", HueName, ".", HueStep])])

const HueScaleDefinition = Schema.Record(HueStep, HexColor)
const HueValueDefinition = Schema.Union([Schema.TemplateLiteral(["$hue.", HueName]), HueScaleDefinition])

const HueDefinition = Schema.Struct({
  gray: HueValueDefinition,
  red: HueValueDefinition,
  orange: HueValueDefinition,
  yellow: HueValueDefinition,
  green: HueValueDefinition,
  cyan: HueValueDefinition,
  blue: HueValueDefinition,
  purple: HueValueDefinition,
  accent: HueValueDefinition,
  interactive: HueValueDefinition,
  neutral: HueValueDefinition,
})
export type HueDefinition = Schema.Schema.Type<typeof HueDefinition>

const StatefulColorDefinition = Schema.Struct({
  base: Schema.optional(ColorValue),
  $hovered: Schema.optional(ColorValue),
  $focused: Schema.optional(ColorValue),
  $pressed: Schema.optional(ColorValue),
  $selected: Schema.optional(ColorValue),
  $disabled: Schema.optional(ColorValue),
})
export type StatefulColorDefinition = Schema.Schema.Type<typeof StatefulColorDefinition>

export type FormfieldColorDefinition = StatefulColorDefinition

const ActionColorDefinition = Schema.Struct({
  primary: Schema.optional(StatefulColorDefinition),
  secondary: Schema.optional(StatefulColorDefinition),
  destructive: Schema.optional(StatefulColorDefinition),
})

const TextFeedbackDefinition = Schema.Struct({
  base: Schema.optional(ColorValue),
  muted: Schema.optional(ColorValue),
})

const BackgroundFeedbackDefinition = Schema.Struct({
  base: Schema.optional(ColorValue),
})

const TextDefinition = Schema.Struct({
  base: Schema.optional(ColorValue),
  muted: Schema.optional(ColorValue),
  action: Schema.optional(ActionColorDefinition),
  formfield: Schema.optional(StatefulColorDefinition),
  status: Schema.optional(
    Schema.Struct({
      running: Schema.optional(ColorValue),
      question: Schema.optional(ColorValue),
      permission: Schema.optional(ColorValue),
      unread: Schema.optional(ColorValue),
    }),
  ),
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
  base: Schema.optional(ColorValue),
  raised: Schema.optional(
    Schema.Struct({
      base: Schema.optional(ColorValue),
      high: Schema.optional(ColorValue),
      max: Schema.optional(ColorValue),
    }),
  ),
  action: Schema.optional(ActionColorDefinition),
  formfield: Schema.optional(StatefulColorDefinition),
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
  "comment",
  "keyword",
  "function",
  "variable",
  "string",
  "number",
  "type",
  "operator",
  "punctuation",
])
export type SyntaxToken = Schema.Schema.Type<typeof SyntaxToken>
export const SyntaxDefinition = Schema.Record(SyntaxToken, Schema.optionalKey(HueColorValue))
export type SyntaxDefinition = Schema.Schema.Type<typeof SyntaxDefinition>

export const MarkdownToken = Schema.Literals([
  "text",
  "heading",
  "link",
  "linkText",
  "code",
  "blockQuote",
  "emphasis",
  "strong",
  "horizontalRule",
  "listItem",
  "listEnumeration",
  "image",
  "imageText",
  "codeBlock",
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
  border: Schema.optional(Schema.Struct({ base: Schema.optional(ColorValue) })),
  scrollbar: Schema.optional(Schema.Struct({ base: Schema.optional(ColorValue) })),
  diff: Schema.optional(DiffDefinition),
  syntax: Schema.optional(SyntaxDefinition),
  markdown: Schema.optional(MarkdownDefinition),
})
export type ThemeTokensDefinition = Schema.Schema.Type<typeof ThemeTokensDefinition>

const CompleteStatefulColorDefinition = Schema.Struct({
  base: ColorValue,
  $hovered: Schema.optional(ColorValue),
  $focused: Schema.optional(ColorValue),
  $pressed: Schema.optional(ColorValue),
  $selected: Schema.optional(ColorValue),
  $disabled: Schema.optional(ColorValue),
})

const CompleteActionColorDefinition = Schema.Struct({
  primary: CompleteStatefulColorDefinition,
  secondary: CompleteStatefulColorDefinition,
  destructive: CompleteStatefulColorDefinition,
})

const CompleteTextFeedbackDefinition = Schema.Struct({ base: ColorValue, muted: Schema.optional(ColorValue) })
const CompleteBackgroundFeedbackDefinition = Schema.Struct({ base: ColorValue })

const CompleteThemeTokensDefinition = Schema.Struct({
  text: Schema.Struct({
    base: ColorValue,
    muted: ColorValue,
    action: CompleteActionColorDefinition,
    formfield: CompleteStatefulColorDefinition,
    status: Schema.Struct({
      running: ColorValue,
      question: ColorValue,
      permission: ColorValue,
      unread: ColorValue,
    }),
    feedback: Schema.Struct({
      error: CompleteTextFeedbackDefinition,
      warning: CompleteTextFeedbackDefinition,
      success: CompleteTextFeedbackDefinition,
      info: CompleteTextFeedbackDefinition,
    }),
  }),
  background: Schema.Struct({
    base: ColorValue,
    raised: Schema.Struct({ base: ColorValue, high: ColorValue, max: ColorValue }),
    action: CompleteActionColorDefinition,
    formfield: CompleteStatefulColorDefinition,
    feedback: Schema.Struct({
      error: CompleteBackgroundFeedbackDefinition,
      warning: CompleteBackgroundFeedbackDefinition,
      success: CompleteBackgroundFeedbackDefinition,
      info: CompleteBackgroundFeedbackDefinition,
    }),
  }),
  border: Schema.Struct({ base: ColorValue }),
  scrollbar: Schema.Struct({ base: ColorValue }),
  diff: Schema.Struct({
    text: Schema.Struct({ added: ColorValue, removed: ColorValue, context: ColorValue, hunkHeader: ColorValue }),
    background: Schema.Struct({ added: ColorValue, removed: ColorValue, context: ColorValue }),
    highlight: Schema.Struct({ added: ColorValue, removed: ColorValue }),
    lineNumber: Schema.Struct({
      text: ColorValue,
      background: Schema.Struct({ added: ColorValue, removed: ColorValue }),
    }),
  }),
  syntax: Schema.Record(SyntaxToken, HueColorValue),
  markdown: Schema.Record(MarkdownToken, HueColorValue),
})

const ThemeDefinitionFields = Schema.Struct({
  hue: HueDefinition,
  categorical: CategoricalDefinition,
  ...CompleteThemeTokensDefinition.fields,
  "@dialog": Schema.optional(ThemeTokensDefinition),
})
export const ThemeDefinition = ThemeDefinitionFields
export type ThemeDefinition = Schema.Schema.Type<typeof ThemeDefinition>

export const BaseThemeDefinition = Schema.Struct({
  categorical: CategoricalDefinition,
  ...CompleteThemeTokensDefinition.fields,
  "@dialog": Schema.optional(ThemeTokensDefinition),
})
export type BaseThemeDefinition = Schema.Schema.Type<typeof BaseThemeDefinition>

export const ModeDefinition = Schema.Struct({
  hue: HueDefinition,
  categorical: Schema.optional(CategoricalDefinition),
  ...ThemeTokensDefinition.fields,
  "@dialog": Schema.optional(ThemeTokensDefinition),
})
export type ModeDefinition = Schema.Schema.Type<typeof ModeDefinition>

const FileMetadata = {
  $schema: Schema.optional(Schema.String),
  version: Schema.Literal(2),
}
export const ThemeDocument = Schema.Union([
  Schema.Struct({
    ...FileMetadata,
    base: BaseThemeDefinition,
    light: ModeDefinition,
    dark: Schema.optional(ModeDefinition),
  }),
  Schema.Struct({
    ...FileMetadata,
    base: BaseThemeDefinition,
    light: Schema.optional(ModeDefinition),
    dark: ModeDefinition,
  }),
])
export type ThemeDocument = Schema.Schema.Type<typeof ThemeDocument>
