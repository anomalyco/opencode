import { legacyTokens } from "./legacy-tokens"

export const rules = [
  {
    id: "design/no-raw-color",
    description: "Literal colors outside token and theme sources.",
    fix: "Use a semantic `--v2-*` token, for example `var(--v2-text-text-base)` or `bg-v2-background-bg-base`.",
    skill: "opencode-ui-tokens",
  },
  {
    id: "design/no-legacy-token",
    description: "References to legacy v1 color tokens in CSS variables or Tailwind color classes.",
    fix: "Replace the legacy token with the matching semantic `--v2-*` token.",
    skill: "opencode-ui-tokens",
  },
  {
    id: "design/no-solid-line-height",
    description: "Solid line heights (`line-height: 1`, `100%`, Tailwind `leading-none`) that clip glyphs.",
    fix: "Use a line-height token such as `var(--line-height-tight)` or `leading-text-tight`.",
    skill: "opencode-ui-typography",
  },
  {
    id: "design/dark-mode-selector",
    description:
      "Dark mode selectors that do not follow the resolved theme: `.dark`, `[data-theme=dark]`, `prefers-color-scheme`, and Tailwind `dark:`.",
    fix: 'Use semantic tokens that already switch, or `[data-color-scheme="dark"]` when a token cannot express it.',
    skill: "opencode-ui-theming",
  },
  {
    id: "design/no-physical-direction",
    description: "Physical left/right CSS properties, values, and Tailwind classes that break right-to-left layouts.",
    fix: "Use logical equivalents such as `margin-inline-start`, `inset-inline-end`, `ms-*`, `pe-*`, `text-start`.",
    skill: "opencode-ui-i18n-rtl",
  },
] as const

export type RuleID = (typeof rules)[number]["id"]

export type Finding = {
  rule: RuleID
  path: string
  line: number
  column: number
  message: string
  excerpt: string
}

type Hit = {
  rule: RuleID
  offset: number
  message: string
}

const legacy = new Set<string>(legacyTokens)

const themeRules = new Set<RuleID>(["design/no-raw-color", "design/no-legacy-token", "design/dark-mode-selector"])

const themeSources = [
  /(^|\/)src\/styles\/(colors|theme)\.css$/,
  /(^|\/)src\/styles\/tokens\//,
  /(^|\/)src\/styles\/tailwind\/colors\.css$/,
  /(^|\/)src\/theme\//,
]

export function lint(input: { path: string; text: string }) {
  const path = input.path.replaceAll("\\", "/")
  const css = path.endsWith(".css")

  if (!css && !/\.tsx?$/.test(path)) return []
  const exempt = themeSources.some((pattern) => pattern.test(path))
  const lines = input.text.split("\n")

  const starts = lines.reduce<number[]>((result, line, index) => {
    result.push(index === 0 ? 0 : result[index - 1]! + lines[index - 1]!.length + 1)

    return result
  }, [])

  const allowed = lines.map(allowedRules)

  return (css ? lintCss(input.text) : lintScript(input.text))
    .filter((hit) => !(exempt && themeRules.has(hit.rule)))
    .map((hit): Finding => {
      const line = lineIndex(starts, hit.offset)

      return {
        rule: hit.rule,
        path: input.path,
        line: line + 1,
        column: hit.offset - starts[line]! + 1,
        message: hit.message,
        excerpt: lines[line]!.trim().slice(0, 200),
      }
    })
    .filter((finding) => {
      const index = finding.line - 1

      return !allowed[index]!.has(finding.rule) && !(index > 0 && allowed[index - 1]!.has(finding.rule))
    })
    .toSorted((a, b) => a.line - b.line || a.column - b.column)
}

function lineIndex(starts: number[], offset: number) {
  const index = starts.findIndex((start) => start > offset)

  return index === -1 ? starts.length - 1 : index - 1
}

// `design-lint-allow <rule-id>: <reason>`; an allow without a reason does not suppress.
function allowedRules(line: string) {
  return new Set(
    line
      .split("design-lint-allow")
      .slice(1)
      .flatMap((part) => {
        const match = /^\s+([\w/-]+)\s*:(.*)$/.exec(part)

        if (!match) return []
        const reason = match[2]!.replace(/(\*\/|-->|\}).*$/, "").trim()

        return reason ? [match[1]!] : []
      }),
  )
}

function lintCss(text: string) {
  return cssSegments(maskComments(text)).flatMap((segment) => {
    const trimmed = segment.text.trimStart()
    const offset = segment.offset + segment.text.length - trimmed.length

    if (segment.end === "{") return checkPrelude(trimmed, offset)

    if (trimmed.startsWith("@apply")) return checkClassList(trimmed, offset)

    if (trimmed.startsWith("@")) return []

    return checkDeclaration(trimmed, offset)
  })
}

function maskComments(text: string) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
}

function cssSegments(source: string) {
  const segments: { text: string; offset: number; end: string }[] = []
  let start = 0
  let index = 0

  while (index < source.length) {
    const char = source[index]!

    if (char === '"' || char === "'") {
      index = quoteEnd(source, index + 1, char) + 1
      continue
    }

    if (source.startsWith("url(", index)) {
      const end = source.indexOf(")", index)
      index = end === -1 ? source.length : end + 1
      continue
    }

    if (char === "{" || char === ";" || char === "}") {
      segments.push({ text: source.slice(start, index), offset: start, end: char })
      start = index + 1
    }

    index++
  }

  segments.push({ text: source.slice(start), offset: start, end: "" })

  return segments.filter((segment) => segment.text.trim())
}

function quoteEnd(text: string, from: number, quote: string) {
  let index = from

  while (index < text.length && text[index] !== quote && text[index] !== "\n") {
    index += text[index] === "\\" ? 2 : 1
  }

  return Math.min(index, text.length)
}

function checkPrelude(prelude: string, offset: number): Hit[] {
  const message = (found: string) => `Avoid \`${found}\`: it does not follow the resolved theme. ${rules[3].fix}`

  const patterns = prelude.startsWith("@")
    ? [/prefers-color-scheme\s*:\s*(dark|light)/g]
    : [/\.dark(?![\w-])/g, /\[\s*data-theme\s*[~|^$*]?=\s*["']?(dark|light)["']?\s*(\s[is])?\]/g]

  return patterns.flatMap((pattern) =>
    [...prelude.matchAll(pattern)].map((match) => ({
      rule: "design/dark-mode-selector" as const,
      offset: offset + match.index,
      message: message(match[0]),
    })),
  )
}

function checkDeclaration(declaration: string, offset: number): Hit[] {
  const colon = declaration.indexOf(":")

  if (colon === -1) return []
  const property = declaration.slice(0, colon).trim().toLowerCase()

  if (!/^(--)?[a-z-]+$/.test(property)) return []
  const value = declaration.slice(colon + 1)
  const valueOffset = offset + colon + 1
  const masked = value.replace(/url\([^)]*\)|"[^"\n]*"|'[^'\n]*'/gi, (match) => " ".repeat(match.length))

  return [
    // Mask gradients use colors only as alpha stops.
    ...(/^(-webkit-)?mask(-image)?$/.test(property)
      ? []
      : findColors(masked).map((match) => rawColor(match.text, valueOffset + match.index))),
    ...legacyVars(value, valueOffset),
    ...solidLineHeight(property, value.replace(/!important/i, "").trim(), offset),
    ...physicalDeclaration(property, value.replace(/!important/i, "").trim(), offset),
  ]
}

const hexColor = /(?<![\w&#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g

const colorFunction = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(([^()]*\d[^()]*)\)/gi

function findColors(text: string) {
  return [...text.matchAll(hexColor), ...text.matchAll(colorFunction)].map((match) => ({
    text: match[0],
    index: match.index,
  }))
}

function rawColor(color: string, offset: number): Hit {
  return { rule: "design/no-raw-color", offset, message: `Raw color \`${color}\`. ${rules[0].fix}` }
}

function legacyVars(text: string, offset: number): Hit[] {
  return [...text.matchAll(/var\(\s*--([\w-]+)/g)].flatMap((match): Hit[] =>
    legacy.has(match[1]!)
      ? [
          {
            rule: "design/no-legacy-token",
            offset: offset + match.index,
            message: `Legacy token \`--${match[1]}\`. ${rules[1].fix}`,
          },
        ]
      : [],
  )
}

function solidLineHeight(property: string, value: string, offset: number): Hit[] {
  const solid = /^(1(\.0+)?|100%|1em)$/

  if (property === "line-height" && solid.test(value)) return [lineHeightHit(value, offset)]

  if (property !== "font") return []
  const shorthand = /\/\s*(1(\.0+)?|100%|1em)(?=\s)/.exec(value)

  return shorthand ? [lineHeightHit(shorthand[1]!, offset)] : []
}

function lineHeightHit(value: string, offset: number): Hit {
  return {
    rule: "design/no-solid-line-height",
    offset,
    message: `Solid line height \`${value}\` clips glyphs. ${rules[2].fix}`,
  }
}

function physicalDeclaration(property: string, value: string, offset: number): Hit[] {
  const logical = logicalProperty(property)

  if (logical) return [physicalHit(`\`${property}\``, `\`${logical}\``, offset)]

  if (!["text-align", "float", "clear"].includes(property)) return []
  const side = /^(left|right)$/.exec(value)

  if (!side) return []
  const replacement = side[1] === "left" ? "start" : "end"

  if (property === "text-align")
    return [physicalHit(`\`text-align: ${value}\``, `\`text-align: ${replacement}\``, offset)]

  return [physicalHit(`\`${property}: ${value}\``, `\`${property}: inline-${replacement}\``, offset)]
}

function logicalProperty(property: string) {
  if (property === "left") return "inset-inline-start"

  if (property === "right") return "inset-inline-end"
  const corner = /^border-(top|bottom)-(left|right)-radius$/.exec(property)

  if (corner) return `border-${corner[1] === "top" ? "start" : "end"}-${corner[2] === "left" ? "start" : "end"}-radius`

  const side = /^(margin|padding|border|scroll-margin|scroll-padding)-(left|right)(-(?:width|style|color))?$/.exec(
    property,
  )

  if (side) return `${side[1]}-inline-${side[2] === "left" ? "start" : "end"}${side[3] ?? ""}`

  return undefined
}

function physicalHit(found: string, replacement: string, offset: number): Hit {
  return {
    rule: "design/no-physical-direction",
    offset,
    message: `Physical direction ${found} breaks right-to-left layouts. Use ${replacement}.`,
  }
}

function lintScript(text: string) {
  const strings = scriptStrings(text)

  return strings.flatMap((string) => {
    const before = text.slice(Math.max(0, string.start - 80), string.start)

    return [
      ...checkClassList(string.value, string.offset),
      ...legacyVars(string.value, string.offset),
      ...darkThemeString(string.value, before, string.offset),
      ...(/\bstyle\s*=\s*\{?\s*$/.test(before) ? checkDeclarationList(string.value, string.offset) : []),
      ...styleObjectColor(string.value, before, string.offset),
    ]
  })
}

function scriptStrings(text: string) {
  const strings: { start: number; offset: number; value: string }[] = []
  let index = 0

  while (index < text.length) {
    const char = text[index]!

    if (char === "/" && text[index + 1] === "/") {
      const end = text.indexOf("\n", index)
      index = end === -1 ? text.length : end
      continue
    }

    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2)
      index = end === -1 ? text.length : end + 2
      continue
    }

    if (char === '"' || char === "'") {
      const end = quoteEnd(text, index + 1, char)
      strings.push({ start: index, offset: index + 1, value: text.slice(index + 1, end) })
      index = end + 1
      continue
    }

    if (char === "`") {
      const end = templateEnd(text, index + 1)
      strings.push({ start: index, offset: index + 1, value: text.slice(index + 1, end) })
      index = end + 1
      continue
    }

    index++
  }

  return strings
}

function templateEnd(text: string, from: number) {
  let index = from
  let depth = 0

  while (index < text.length) {
    const char = text[index]!

    if (char === "\\") {
      index += 2
      continue
    }

    if (depth === 0 && char === "`") return index

    if (char === "$" && text[index + 1] === "{") {
      depth++
      index += 2
      continue
    }

    if (depth > 0 && char === "{") depth++

    if (depth > 0 && char === "}") depth--
    index++
  }

  return text.length
}

function checkDeclarationList(text: string, offset: number) {
  return text.split(";").reduce<{ hits: Hit[]; position: number }>(
    (result, declaration) => ({
      hits: [...result.hits, ...checkDeclaration(declaration, offset + result.position)],
      position: result.position + declaration.length + 1,
    }),
    { hits: [], position: 0 },
  ).hits
}

function darkThemeString(value: string, before: string, offset: number): Hit[] {
  const attribute = /data-theme\s*[~|^$*]?=\s*\\?["']?(dark|light)\b/.exec(value)

  if (attribute) return [darkHit(attribute[0], offset + attribute.index)]

  if (!/^(dark|light)$/.test(value)) return []

  if (/(data-theme\s*=\s*\{?|dataset\.theme\s*[!=]==?|classList\.(add|remove|toggle|contains)\()\s*$/.test(before)) {
    return [darkHit(value, offset)]
  }

  return []
}

function darkHit(found: string, offset: number): Hit {
  return {
    rule: "design/dark-mode-selector",
    offset,
    message: `Avoid \`${found}\`: \`data-theme\` holds the theme ID and no \`.dark\` class exists. ${rules[3].fix}`,
  }
}

function styleObjectColor(value: string, before: string, offset: number) {
  const key = /(?:^|[{,\s])["']?([a-zA-Z-]+)["']?\s*:\s*$/.exec(before)

  if (!key || !/color|background|fill|stroke|border|outline|shadow|caret|accent|decoration/i.test(key[1]!)) return []

  return findColors(value).map((match) => rawColor(match.text, offset + match.index))
}

function checkClassList(text: string, offset: number) {
  return [...text.matchAll(/[^\s"'`{}]+/g)].flatMap((match) => checkClass(match[0], offset + match.index))
}

function checkClass(token: string, offset: number): Hit[] {
  const parts = splitVariants(token)
  const utility = parts.at(-1)!.replace(/^!|!$/g, "")

  if (!utility || !/^-?[a-z[(]/.test(utility)) return []
  const variants = parts.slice(0, -1)
  const bare = utility.replace(/^-/, "")
  const property = /^\[([a-z-]+):(.+)\]$/.exec(bare)

  return [
    ...(variants.includes("dark")
      ? [
          {
            rule: "design/dark-mode-selector" as const,
            offset,
            message: `Tailwind \`dark:\` follows \`prefers-color-scheme\`, not the resolved theme. ${rules[3].fix}`,
          },
        ]
      : []),
    ...(property
      ? checkDeclaration(`${property[1]}:${property[2]!.replaceAll("_", " ")}`, 0).map((hit) => ({ ...hit, offset }))
      : arbitraryColor(bare, offset)),
    ...solidLeading(bare, offset),
    ...physicalClass(bare, offset),
    ...legacyClass(bare, offset),
  ]
}

function splitVariants(token: string) {
  const parts = [""]
  let depth = 0

  for (const char of token) {
    if (char === "[" || char === "(") depth++

    if (char === "]" || char === ")") depth--

    if (char === ":" && depth === 0) {
      parts.push("")
      continue
    }

    parts[parts.length - 1] += char
  }

  return parts
}

function arbitraryColor(utility: string, offset: number) {
  const arbitrary = /\[(.+)\]/.exec(utility)

  if (!arbitrary) return []

  return findColors(arbitrary[1]!).map((match) => rawColor(match.text, offset))
}

function solidLeading(utility: string, offset: number) {
  if (!/^leading-(none|\[(1(\.0+)?|100%|1em)\])$/.test(utility)) return []

  return [lineHeightHit(utility, offset)]
}

const spacingValue = /^(\d+(\.\d+)?|px|auto|full|\d+\/\d+|\[.+\]|\(.+\))$/

const radiusValue = /^(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[.+\]|\(.+\))$/

const physicalClasses = [
  ["scroll-ml", "scroll-ms", spacingValue],
  ["scroll-mr", "scroll-me", spacingValue],
  ["scroll-pl", "scroll-ps", spacingValue],
  ["scroll-pr", "scroll-pe", spacingValue],
  ["rounded-tl", "rounded-ss", radiusValue],
  ["rounded-tr", "rounded-se", radiusValue],
  ["rounded-bl", "rounded-es", radiusValue],
  ["rounded-br", "rounded-ee", radiusValue],
  ["rounded-l", "rounded-s", radiusValue],
  ["rounded-r", "rounded-e", radiusValue],
  ["border-l", "border-s", /^.+$/],
  ["border-r", "border-e", /^.+$/],
  ["text-left", "text-start", undefined],
  ["text-right", "text-end", undefined],
  ["float-left", "float-start", undefined],
  ["float-right", "float-end", undefined],
  ["clear-left", "clear-start", undefined],
  ["clear-right", "clear-end", undefined],
  ["ml", "ms", spacingValue],
  ["mr", "me", spacingValue],
  ["pl", "ps", spacingValue],
  ["pr", "pe", spacingValue],
  ["left", "start", spacingValue],
  ["right", "end", spacingValue],
] as const

function physicalClass(utility: string, offset: number): Hit[] {
  const match = physicalClasses.find(([prefix, , value]) => {
    if (utility === prefix) return !value || value !== spacingValue

    if (!utility.startsWith(prefix + "-") || !value) return false

    return value.test(utility.slice(prefix.length + 1))
  })

  if (!match) return []

  return [physicalHit(`\`${match[0]}\``, `\`${match[1]}\``, offset)]
}

const colorUtility =
  /^(?:bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|fill|stroke|divide|from|via|to|placeholder|caret|accent|decoration|shadow|inset-shadow|inset-ring)-(.+?)(?:\/[\w.[\]%]+)?$/

const textSizes = new Set(["sm", "base", "lg", "xl"])

function legacyClass(utility: string, offset: number): Hit[] {
  const match = colorUtility.exec(utility)

  if (!match || !legacy.has(match[1]!)) return []

  if (utility.startsWith("text-") && textSizes.has(match[1]!)) return []

  return [
    {
      rule: "design/no-legacy-token",
      offset,
      message: `Legacy color class \`${utility}\`. ${rules[1].fix}`,
    },
  ]
}
