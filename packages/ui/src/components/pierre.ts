import { FileDiffOptions } from "@pierre/precision-diffs"

export function createDefaultOptions<T>(style: FileDiffOptions<T>["diffStyle"]) {
  return {
    theme: "OpenCode",
    themeType: "system",
    disableLineNumbers: false,
    overflow: "wrap",
    diffStyle: style ?? "unified",
    diffIndicators: "bars",
    disableBackground: false,
    expansionLineCount: 20,
    lineDiffType: style === "split" ? "word-alt" : "none",
    maxLineDiffLength: 1000,
    maxLineLengthForHighlighting: 1000,
    disableFileHeader: true,
    unsafeCSS: `
[data-pjs-header],
[data-pjs] {
  [data-separator-wrapper] {
    margin: 0 !important;
    border-radius: 0 !important;
  }
  [data-expand-button] {
    width: 6.5ch !important;
    height: 24px !important;
    justify-content: end !important;
    padding-left: 3ch !important;
    padding-inline: 1ch !important;
  }
  [data-separator-multi-button] {
    grid-template-rows: 10px 10px !important;
    [data-expand-button] {
      height: 12px !important;
    }
  }
  [data-separator-content] {
    height: 24px !important;
  }
}`,
    // hunkSeparators(hunkData: HunkData) {
    //   const fragment = document.createDocumentFragment()
    //   const numCol = document.createElement("div")
    //   numCol.innerHTML = `<svg data-slot="diff-hunk-separator-line-number-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.97978 14.0204L8.62623 13.6668L9.33334 12.9597L9.68689 13.3133L9.33333 13.6668L8.97978 14.0204ZM12 16.3335L12.3535 16.6871L12 17.0406L11.6464 16.687L12 16.3335ZM14.3131 13.3133L14.6667 12.9597L15.3738 13.6668L15.0202 14.0204L14.6667 13.6668L14.3131 13.3133ZM12.5 16.0002V16.5002H11.5V16.0002H12H12.5ZM9.33333 13.6668L9.68689 13.3133L12.3535 15.9799L12 16.3335L11.6464 16.687L8.97978 14.0204L9.33333 13.6668ZM12 16.3335L11.6464 15.9799L14.3131 13.3133L14.6667 13.6668L15.0202 14.0204L12.3535 16.6871L12 16.3335ZM6.5 8.00016V7.50016H8.5V8.00016V8.50016H6.5V8.00016ZM9.5 8.00016V7.50016H11.5V8.00016V8.50016H9.5V8.00016ZM12.5 8.00016V7.50016H14.5V8.00016V8.50016H12.5V8.00016ZM15.5 8.00016V7.50016H17.5V8.00016V8.50016H15.5V8.00016ZM12 10.5002H12.5V16.0002H12H11.5V10.5002H12Z" fill="currentColor"/></svg> `
    //   numCol.dataset["slot"] = "diff-hunk-separator-line-number"
    //   fragment.appendChild(numCol)
    //   const contentCol = document.createElement("div")
    //   contentCol.dataset["slot"] = "diff-hunk-separator-content"
    //   const span = document.createElement("span")
    //   span.dataset["slot"] = "diff-hunk-separator-content-span"
    //   span.textContent = `${hunkData.lines} unmodified lines`
    //   contentCol.appendChild(span)
    //   fragment.appendChild(contentCol)
    //   return fragment
    // },
  } as const
}

export const styleVariables = {
  "--pjs-font-family": "var(--font-family-mono)",
  "--pjs-font-size": "var(--font-size-small)",
  "--pjs-line-height": "24px",
  "--pjs-tab-size": 2,
  "--pjs-font-features": "var(--font-family-mono--font-feature-settings)",
  "--pjs-header-font-family": "var(--font-family-sans)",
  "--pjs-gap-block": 0,
  "--pjs-min-number-column-width": "4ch",
}
