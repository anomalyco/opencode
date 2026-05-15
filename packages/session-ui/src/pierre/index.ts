import { DiffLineAnnotation, FileContents, FileDiffOptions, type SelectedLineRange } from "@pierre/diffs"
import { ComponentProps } from "solid-js"
import { lineCommentStyles } from "../components/line-comment-styles"

export type DiffProps<T = {}> = FileDiffOptions<T> & {
  before: FileContents
  after: FileContents
  annotations?: DiffLineAnnotation<T>[]
  selectedLines?: SelectedLineRange | null
  commentedLines?: SelectedLineRange[]
  onLineNumberSelectionEnd?: (selection: SelectedLineRange | null) => void
  onRendered?: () => void
  class?: string
  classList?: ComponentProps<"div">["classList"]
}

const unsafeCSS = `
:host {
  --diffs-bg: var(--opencode-diffs-bg, var(--color-background-stronger));
}

[data-diff],
[data-file] {
  /* Pierre 1.2 mixes these override targets at 12% in light mode and 20% in dark mode. */
  --diffs-bg-deletion-override: light-dark(
    color-mix(in lab, var(--diffs-bg) 33.333%, var(--diffs-deletion-base)),
    color-mix(in lab, var(--diffs-bg) 60%, var(--diffs-deletion-base))
  );
  --diffs-bg-deletion-number-override: var(--diffs-bg-deletion-override);
  --diffs-bg-addition-override: light-dark(
    color-mix(in lab, var(--diffs-bg) 33.333%, var(--diffs-addition-base)),
    color-mix(in lab, var(--diffs-bg) 60%, var(--diffs-addition-base))
  );
  --diffs-bg-addition-number-override: var(--diffs-bg-addition-override);
  --diffs-selection-base: var(--v2-background-bg-accent);
  --diffs-selection-number-fg: var(--v2-text-text-accent);
  --diffs-comment-bg: rgb(from var(--v2-background-bg-accent) r g b / 0.06);
  /* Use explicit alpha instead of color-mix(..., transparent) to avoid Safari's non-premultiplied interpolation bugs. */
  --diffs-bg-selection: var(--diffs-bg-selection-override, rgb(from var(--diffs-selection-base) r g b / 0.2));
  --diffs-bg-selection-number: var(--diffs-bg-selection-number-override, var(--diffs-bg-selection));
  --diffs-bg-selection-text: rgb(from var(--diffs-selection-base) r g b / 0.2);
}

[data-diff] ::selection,
[data-file] ::selection {
  background-color: var(--diffs-bg-selection-text);
}

[data-indicators='bars'] [data-column-number][data-line-type='change-addition']::before,
[data-indicators='bars'] [data-column-number][data-line-type='change-deletion']::before {
  width: 2px;
}

[data-indicators='bars'] [data-column-number][data-line-type='change-deletion']::before {
  background-image: none;
  background-color: var(--diffs-deletion-base);
}

[data-background] [data-column-number] {
  --mix-light: 88%;
  --mix-dark: 80%;
}

[data-diff-type='split'] [data-additions],
[data-diff-type='split'] [data-additions] [data-gutter],
[data-diff-type='split'] [data-deletions],
[data-diff-type='split'] [data-deletions] [data-content] {
  border-left: 0;
  border-right: 0;
}

[data-content-buffer] {
  background-image: none;
  background-color: var(--diffs-bg-context-gutter);
}

::highlight(opencode-find) {
  background-color: rgb(from var(--surface-warning-base) r g b / 0.35);
}

::highlight(opencode-find-current) {
  background-color: rgb(from var(--surface-warning-strong) r g b / 0.55);
}

[data-diff] [data-line][data-comment-selected]:not([data-selected-line]) {
  box-shadow: inset 0 0 0 9999px var(--diffs-bg-selection);
}

[data-file] [data-line][data-comment-selected]:not([data-selected-line]) {
  box-shadow: inset 0 0 0 9999px var(--diffs-bg-selection);
}

[data-diff] [data-column-number][data-comment-selected]:not([data-selected-line]) {
  box-shadow: inset 0 0 0 9999px var(--diffs-bg-selection-number);
  color: var(--diffs-selection-number-fg);
}

[data-file] [data-column-number][data-comment-selected]:not([data-selected-line]) {
  box-shadow: inset 0 0 0 9999px var(--diffs-bg-selection-number);
  color: var(--diffs-selection-number-fg);
}

[data-diff] [data-line-annotation],
[data-diff] [data-gutter-buffer='annotation'],
[data-file] [data-line-annotation],
[data-file] [data-gutter-buffer='annotation'] {
  --diffs-annotation-bg: var(--diffs-comment-bg);
  --diffs-computed-decoration-bg: var(--diffs-comment-bg);
  --diffs-computed-diff-line-bg: var(--diffs-comment-bg);
  --diffs-computed-selected-line-bg: var(--diffs-comment-bg);
  --diffs-line-bg: var(--diffs-comment-bg);
  background-color: var(--diffs-comment-bg);
}

[data-diff] [data-line][data-selected-line] {
  background-color: var(--diffs-bg-selection);
}

[data-file] [data-line][data-selected-line] {
  background-color: var(--diffs-bg-selection);
}

[data-diff] [data-column-number][data-selected-line] {
  background-color: var(--diffs-bg-selection-number);
  color: var(--diffs-selection-number-fg);
}

[data-file] [data-column-number][data-selected-line] {
  background-color: var(--diffs-bg-selection-number);
  color: var(--diffs-selection-number-fg);
}

[data-diff] [data-column-number][data-line-type='context'][data-selected-line],
[data-diff] [data-column-number][data-line-type='context-expanded'][data-selected-line],
[data-diff] [data-column-number][data-line-type='change-addition'][data-selected-line],
[data-diff] [data-column-number][data-line-type='change-deletion'][data-selected-line] {
  color: var(--diffs-selection-number-fg);
}

@media (pointer: fine) {
  [data-gutter-utility-slot] {
    opacity: 0;
    pointer-events: none;
  }

  [data-column-number][data-hovered] [data-gutter-utility-slot],
  [data-gutter-utility-slot]:focus-within {
    opacity: 1;
    pointer-events: auto;
  }
}

/* The deletion word-diff emphasis is stronger than additions; soften it while selected so the selection highlight reads consistently. */
[data-diff] [data-line][data-line-type='change-deletion'][data-selected-line] {
  --diffs-bg-deletion-emphasis: light-dark(
    rgb(from var(--diffs-deletion-base) r g b / 0.07),
    rgb(from var(--diffs-deletion-base) r g b / 0.1)
  );
}

[data-diff-header],
[data-diff],
[data-file] {
  [data-separator] {
    height: 24px;
  }
  [data-column-number] {
    cursor: default !important;
  }

  &[data-interactive-line-numbers] [data-column-number] {
    cursor: default !important;
  }

  &[data-interactive-lines] [data-line] {
    cursor: auto !important;
  }
  [data-code] {
    overflow-x: auto !important;
    overflow-y: clip !important;
  }
}

${lineCommentStyles}

`

export function createDefaultOptions<T>(style: FileDiffOptions<T>["diffStyle"]) {
  return {
    theme: "OpenCode",
    themeType: "system",
    disableLineNumbers: false,
    overflow: "wrap",
    diffStyle: style ?? "unified",
    diffIndicators: "bars",
    lineHoverHighlight: "both",
    disableBackground: false,
    expansionLineCount: 20,
    hunkSeparators: "line-info-basic",
    lineDiffType: style === "split" ? "word-alt" : "none",
    maxLineDiffLength: 1000,
    maxLineLengthForHighlighting: 1000,
    disableFileHeader: true,
    unsafeCSS,
  } as const
}

export const styleVariables = {
  "--diffs-font-family": "var(--font-family-mono)",
  "--diffs-font-size": "var(--font-size-mono)",
  "--diffs-line-height": "var(--line-height-mono-px)",
  "--diffs-tab-size": 2,
  "--diffs-font-features": "var(--font-family-mono--font-feature-settings)",
  "--diffs-header-font-family": "var(--font-family-sans)",
  "--diffs-gap-block": 0,
  "--diffs-gap-style": 0,
  "--diffs-min-number-column-width": "3ch",
}
