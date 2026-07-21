import type { MermaidColorScheme } from "./markdown-mermaid"

// Slate theme for mermaid's "base" theme engine, tuned for parsing large charts:
// neutral node surfaces, higher-contrast edges and borders, and desaturated categorical
// hues (state/timeline/git scales) that stay distinguishable without overpowering labels.
// Values must be concrete colors because mermaid derives unset tokens with color math.

type MermaidThemeVariables = Record<string, string | boolean>

function withScales(theme: MermaidThemeVariables, scale: string[], label: string) {
  scale.forEach((color, index) => {
    theme[`cScale${index}`] = color
    theme[`cScaleLabel${index}`] = label
    theme[`git${index}`] = color
    theme[`gitBranchLabel${index}`] = label
  })
  return theme
}

const dark = withScales(
  {
    darkMode: true,
    background: "#101014",
    textColor: "#e2e8f0",
    titleColor: "#f1f5f9",
    lineColor: "#94a3b8",
    defaultLinkColor: "#94a3b8",

    mainBkg: "#1e293b",
    nodeBorder: "#64748b",
    nodeTextColor: "#e2e8f0",
    primaryColor: "#1e293b",
    primaryTextColor: "#e2e8f0",
    primaryBorderColor: "#64748b",
    secondaryColor: "#26324b",
    secondaryBorderColor: "#5b6f96",
    secondaryTextColor: "#dbe4f0",
    tertiaryColor: "#1f3a37",
    tertiaryBorderColor: "#4f7d76",
    tertiaryTextColor: "#d7e8e5",

    clusterBkg: "#161c28",
    clusterBorder: "#475569",
    edgeLabelBackground: "#101014",

    noteBkgColor: "#382e1b",
    noteTextColor: "#ecd9a8",
    noteBorderColor: "#8a7440",

    actorBkg: "#1e293b",
    actorBorder: "#64748b",
    actorTextColor: "#e2e8f0",
    actorLineColor: "#64748b",
    signalColor: "#94a3b8",
    signalTextColor: "#cbd5e1",
    labelBoxBkgColor: "#161c28",
    labelBoxBorderColor: "#475569",
    labelTextColor: "#cbd5e1",
    loopTextColor: "#cbd5e1",
    activationBkgColor: "#334155",
    activationBorderColor: "#94a3b8",
    sequenceNumberColor: "#0f172a",

    errorBkgColor: "#3f1d1d",
    errorTextColor: "#fca5a5",
  },
  ["#334155", "#243d5c", "#1c443c", "#413620", "#3a2b4e", "#46252e", "#2a3f22", "#1b4450"],
  "#e2e8f0",
)

const light = withScales(
  {
    darkMode: false,
    background: "#fafafa",
    textColor: "#1e293b",
    titleColor: "#0f172a",
    lineColor: "#64748b",
    defaultLinkColor: "#64748b",

    mainBkg: "#f1f5f9",
    nodeBorder: "#94a3b8",
    nodeTextColor: "#1e293b",
    primaryColor: "#f1f5f9",
    primaryTextColor: "#1e293b",
    primaryBorderColor: "#94a3b8",
    secondaryColor: "#e5edf8",
    secondaryBorderColor: "#8fa8c9",
    secondaryTextColor: "#243b56",
    tertiaryColor: "#e2f1ee",
    tertiaryBorderColor: "#6fa298",
    tertiaryTextColor: "#1f4d44",

    clusterBkg: "#f8fafc",
    clusterBorder: "#cbd5e1",
    edgeLabelBackground: "#fafafa",

    noteBkgColor: "#faf3dc",
    noteTextColor: "#6a5518",
    noteBorderColor: "#d3bc72",

    actorBkg: "#f1f5f9",
    actorBorder: "#94a3b8",
    actorTextColor: "#1e293b",
    actorLineColor: "#94a3b8",
    signalColor: "#475569",
    signalTextColor: "#334155",
    labelBoxBkgColor: "#f8fafc",
    labelBoxBorderColor: "#cbd5e1",
    labelTextColor: "#334155",
    loopTextColor: "#334155",
    activationBkgColor: "#e2e8f0",
    activationBorderColor: "#64748b",
    sequenceNumberColor: "#f8fafc",

    errorBkgColor: "#fee2e2",
    errorTextColor: "#b91c1c",
  },
  ["#e2e8f0", "#d8e4f3", "#d5ebe4", "#f1e7c6", "#e7def2", "#f4dbe0", "#ddecd3", "#d3e7ee"],
  "#1e293b",
)

export function mermaidThemeVariables(scheme: MermaidColorScheme) {
  return scheme === "dark" ? dark : light
}

type MermaidAccent = { fill: string; stroke: string }

const darkAccents: Record<string, MermaidAccent> = {
  info: { fill: "#243d5c", stroke: "#5b7fa6" },
  success: { fill: "#2a3f22", stroke: "#6f9a62" },
  warning: { fill: "#413620", stroke: "#8a7440" },
  danger: { fill: "#46252e", stroke: "#b06a7a" },
  muted: { fill: "#1a1d24", stroke: "#3d4451" },
}

const lightAccents: Record<string, MermaidAccent> = {
  info: { fill: "#d8e4f3", stroke: "#7d9cc4" },
  success: { fill: "#ddecd3", stroke: "#86ab78" },
  warning: { fill: "#f1e7c6", stroke: "#b7a054" },
  danger: { fill: "#f4dbe0", stroke: "#c2808f" },
  muted: { fill: "#f8fafc", stroke: "#d3dae3" },
}

const storage: Record<MermaidColorScheme, MermaidAccent> = {
  dark: { fill: "#3a2b4e", stroke: "#7d6a9e" },
  light: { fill: "#e7def2", stroke: "#a48cc8" },
}

// Injected via mermaid's themeCSS, which stylis scopes under the rendered diagram's #id.
// Flowchart nodes all carry class="node default", so semantics come from two layers:
// shape buckets (polygons are decisions and other branch-like shapes, circles and stadium
// groups are terminals, cylinder paths are storage) and author classes (`A:::warning`),
// which mermaid passes through to the node without requiring a classDef. The doubled
// class in semantic rules outranks the shape buckets; classDef inline styles still win.
export function mermaidThemeCss(scheme: MermaidColorScheme) {
  const accents = scheme === "dark" ? darkAccents : lightAccents
  const shapes = [
    `.node polygon.label-container { fill: ${accents.warning.fill}; stroke: ${accents.warning.stroke}; }`,
    `.node circle.basic { fill: ${accents.info.fill}; stroke: ${accents.info.stroke}; }`,
    `.node g.basic :is(path, circle) { fill: ${accents.info.fill}; stroke: ${accents.info.stroke}; }`,
    `.node path.basic { fill: ${storage[scheme].fill}; stroke: ${storage[scheme].stroke}; }`,
  ]
  const semantic = Object.entries(accents).map(
    ([name, accent]) =>
      `.node.${name}.${name} :is(rect, polygon, circle, ellipse, path) { fill: ${accent.fill}; stroke: ${accent.stroke}; }`,
  )
  return [...shapes, ...semantic, `.node.muted.muted .label { opacity: 0.65; }`].join("\n")
}
