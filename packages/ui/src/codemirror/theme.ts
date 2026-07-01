import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"
import type { Extension } from "@codemirror/state"

export function ocEditorTheme(): Extension {
  return [
    EditorView.theme(
      {
        "&": {
          color: "var(--text-base)",
          backgroundColor: "var(--background-stronger, var(--background-base))",
          fontFamily: "var(--font-family-mono)",
          fontSize: "var(--font-size-small, 13px)",
          height: "100%",
        },
        ".cm-content": {
          caretColor: "var(--text-strong)",
          fontFamily: "var(--font-family-mono)",
          padding: "0",
          lineHeight: "24px",
          fontFeatureSettings: "var(--font-family-mono--font-feature-settings)",
        },
        ".cm-line": {
          lineHeight: "24px",
          padding: "0 1ch",
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "var(--text-strong)",
        },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
          {
            backgroundColor: "var(--surface-base-interactive-active, rgba(128,128,128,0.3))",
          },
        ".cm-activeLine": {
          backgroundColor: "var(--surface-base, rgba(128,128,128,0.06))",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "var(--surface-base, rgba(128,128,128,0.06))",
        },
        ".cm-gutters": {
          backgroundColor: "var(--background-stronger, var(--background-base))",
          color: "var(--diffs-fg-number, var(--text-weak))",
          border: "none",
          fontFamily: "var(--font-family-mono)",
          fontFeatureSettings: "var(--font-family-mono--font-feature-settings)",
        },
        ".cm-lineNumbers .cm-gutterElement": {
          color: "color-mix(in lab, var(--text-base) 65%, var(--background-stronger))",
          lineHeight: "24px",
          // Measured px to match Pierre's fixed-px gutter at the app's single font size.
          padding: "0 10.2px 0 31.2px",
          textAlign: "right",
        },
        ".cm-foldPlaceholder": {
          backgroundColor: "transparent",
          border: "none",
          color: "var(--text-weak)",
        },
        ".cm-tooltip": {
          backgroundColor: "var(--surface-raised-stronger-non-alpha, var(--surface-float-base, var(--background-strong)))",
          backgroundClip: "padding-box",
          border: "1px solid color-mix(in oklch, var(--border-base) 50%, transparent)",
          borderRadius: "var(--radius-md, 6px)",
          color: "var(--text-strong)",
          boxShadow: "var(--shadow-md, 0 4px 16px rgba(0,0,0,0.28))",
          overflow: "hidden",
        },
        ".cm-tooltip.cm-tooltip-autocomplete": {
          padding: "4px",
        },
        ".cm-tooltip.cm-tooltip-autocomplete > ul": {
          fontFamily: "var(--font-family-sans, sans-serif)",
          fontSize: "var(--font-size-small, 13px)",
          fontWeight: "var(--font-weight-medium, 500)",
          lineHeight: "var(--line-height-large, 1.6)",
          letterSpacing: "var(--letter-spacing-normal, normal)",
          maxHeight: "18em",
          minWidth: "16em",
        },
        ".cm-tooltip-autocomplete > ul > li": {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "4px 8px",
          borderRadius: "var(--radius-sm, 4px)",
          cursor: "default",
          userSelect: "none",
          color: "var(--text-strong)",
        },
        ".cm-tooltip-autocomplete > ul > li:hover": {
          backgroundColor: "var(--surface-raised-base-hover, rgba(128,128,128,0.12))",
        },
        ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
          backgroundColor: "var(--surface-raised-base-hover, var(--surface-base-active, rgba(128,128,128,0.2)))",
          color: "var(--text-strong)",
        },
        ".cm-completionLabel": { color: "var(--text-strong)", flex: "0 0 auto" },
        ".cm-completionMatchedText": {
          color: "var(--text-interactive-base, var(--syntax-keyword, var(--text-strong)))",
          textDecoration: "none",
          fontWeight: "var(--font-weight-medium, 600)",
        },
        ".cm-completionDetail": {
          color: "var(--text-weak)",
          fontStyle: "normal",
          fontFamily: "var(--font-family-mono)",
          marginLeft: "auto",
          paddingLeft: "1.5em",
          fontSize: "var(--font-size-x-small, 0.85em)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
        ".cm-completionIcon": {
          color: "var(--text-weak)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          width: "1.35em",
          height: "1.35em",
          marginRight: "0",
          padding: "0",
          fontSize: "0.85em",
          opacity: "1",
          borderRadius: "var(--radius-sm, 4px)",
          backgroundColor: "color-mix(in oklch, currentColor 16%, transparent)",
          flex: "0 0 auto",
        },
        ".cm-completionIcon::after": { opacity: "1" },
        ".cm-tooltip.cm-tooltip-lint": { padding: "0" },
        ".cm-tooltip-lint .cm-diagnostic": {
          padding: "8px 10px 8px 12px",
          margin: "0",
          borderLeft: "3px solid var(--border-base, transparent)",
          fontFamily: "var(--font-family-sans, sans-serif)",
          fontSize: "var(--font-size-small, 13px)",
          lineHeight: "1.5",
          color: "var(--text-strong)",
          whiteSpace: "pre-wrap",
        },
        ".cm-tooltip-lint .cm-diagnostic-error": { borderLeftColor: "var(--syntax-critical, #e5484d)" },
        ".cm-tooltip-lint .cm-diagnostic-warning": { borderLeftColor: "var(--syntax-warning, #f5a623)" },
        ".cm-tooltip-lint .cm-diagnostic-info": { borderLeftColor: "var(--syntax-info, var(--text-weak))" },
        ".cm-diagnosticSource": {
          display: "block",
          marginTop: "4px",
          fontFamily: "var(--font-family-mono)",
          fontSize: "var(--font-size-x-small, 0.8em)",
          color: "var(--text-weak)",
          opacity: "0.85",
        },
        ".cm-completionIcon-function, .cm-completionIcon-method": { color: "var(--syntax-object, var(--text-strong))" },
        ".cm-completionIcon-class, .cm-completionIcon-interface, .cm-completionIcon-type, .cm-completionIcon-struct": {
          color: "var(--syntax-type, var(--text-base))",
        },
        ".cm-completionIcon-keyword": { color: "var(--syntax-keyword, var(--text-base))" },
        ".cm-completionIcon-variable, .cm-completionIcon-property, .cm-completionIcon-field": {
          color: "var(--syntax-property, var(--text-base))",
        },
        ".cm-completionIcon-constant, .cm-completionIcon-enum": { color: "var(--syntax-constant, var(--text-base))" },
        ".cm-completionInfo": {
          backgroundColor: "var(--surface-raised-stronger-non-alpha, var(--surface-float-base, var(--background-strong)))",
          border: "1px solid color-mix(in oklch, var(--border-base) 50%, transparent)",
          borderRadius: "var(--radius-md, 6px)",
          boxShadow: "var(--shadow-md, 0 4px 16px rgba(0,0,0,0.28))",
          padding: "8px 10px",
          maxWidth: "420px",
          maxHeight: "320px",
          overflow: "auto",
          fontFamily: "var(--font-family-sans, sans-serif)",
          fontSize: "var(--font-size-small, 13px)",
          lineHeight: "1.5",
          color: "var(--text-base)",
        },
        ".cm-completion-doc-signature": {
          fontFamily: "var(--font-family-mono)",
          fontSize: "0.95em",
          color: "var(--text-strong)",
          whiteSpace: "pre-wrap",
          marginBottom: "6px",
          paddingBottom: "6px",
          borderBottom: "1px solid var(--border-weak-base, rgba(128,128,128,0.2))",
        },
        ".cm-completion-doc-signature:last-child": {
          marginBottom: "0",
          paddingBottom: "0",
          borderBottom: "none",
        },
        ".cm-completion-doc-body": {
          padding: "0",
          maxWidth: "none",
          maxHeight: "none",
          overflow: "visible",
        },
        ".cm-tooltip-hover": { pointerEvents: "auto" },
        ".cm-lsp-hover": {
          padding: "8px 10px",
          maxWidth: "560px",
          maxHeight: "320px",
          overflow: "auto",
          fontFamily: "var(--font-family-sans, sans-serif)",
          fontSize: "var(--font-size-small, 13px)",
          lineHeight: "1.6",
          color: "var(--text-strong)",
          overflowWrap: "break-word",
          userSelect: "text",
          WebkitUserSelect: "text",
          cursor: "auto",
        },
        ".cm-lsp-hover > *:first-child": { marginTop: "0" },
        ".cm-lsp-hover > *:last-child": { marginBottom: "0" },
        ".cm-lsp-hover p": { margin: "0 0 0.5em" },
        ".cm-lsp-hover p:last-child": { margin: "0" },
        ".cm-lsp-hover h1, .cm-lsp-hover h2, .cm-lsp-hover h3, .cm-lsp-hover h4, .cm-lsp-hover h5, .cm-lsp-hover h6":
          {
            fontSize: "1em",
            fontWeight: "var(--font-weight-medium, 600)",
            color: "var(--text-strong)",
            margin: "0 0 0.4em",
          },
        ".cm-lsp-hover strong, .cm-lsp-hover b": {
          color: "var(--text-strong)",
          fontWeight: "var(--font-weight-medium, 600)",
        },
        ".cm-lsp-hover ul, .cm-lsp-hover ol": { margin: "0 0 0.5em", paddingLeft: "1.4em" },
        ".cm-lsp-hover li": { margin: "0.1em 0" },
        ".cm-lsp-hover pre": {
          backgroundColor: "var(--surface-base, rgba(128,128,128,0.12))",
          padding: "6px 8px",
          borderRadius: "var(--radius-sm, 4px)",
          overflow: "auto",
          margin: "0 0 0.5em",
          fontFamily: "var(--font-family-mono)",
          fontSize: "0.95em",
          lineHeight: "1.45",
        },
        ".cm-lsp-hover code": {
          backgroundColor: "var(--surface-base, rgba(128,128,128,0.12))",
          padding: "0.1em 0.3em",
          borderRadius: "3px",
          fontFamily: "var(--font-family-mono)",
          fontSize: "0.95em",
          color: "var(--text-strong)",
        },
        ".cm-lsp-hover pre code": { backgroundColor: "transparent", padding: "0", color: "inherit" },
        ".cm-lsp-hover a": {
          color: "var(--text-interactive-base, var(--syntax-info, var(--text-link)))",
          textDecoration: "none",
        },
        ".cm-lsp-hover a:hover": { textDecoration: "underline", textUnderlineOffset: "2px" },
        ".cm-lsp-hover hr": {
          border: "none",
          borderTop: "1px solid var(--border-weak-base, var(--border-base, rgba(128,128,128,0.3)))",
          margin: "0.5em 0",
        },
        ".cm-searchMatch": {
          backgroundColor: "var(--surface-base-active, rgba(128,128,128,0.25))",
        },
        ".cm-searchMatch.cm-searchMatch-selected": {
          backgroundColor: "var(--surface-base-interactive-active, rgba(128,128,128,0.4))",
        },
        ".cm-selectionMatch": {
          backgroundColor: "var(--surface-base, rgba(128,128,128,0.15))",
        },
      },
    ),
    // Lezer highlighting is intentionally NOT included here: it lives in its own
    // compartment (`ocLezerHighlight`) as the fallback shiki replaces. Running
    // both nests spans and the inner Lezer color wins, mis-coloring vs View.
  ]
}

export function ocLezerHighlight(): Extension {
  return syntaxHighlighting(ocHighlightStyle)
}

const ocHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [t.lineComment, t.blockComment, t.docComment], color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: [t.string, t.special(t.string)], color: "var(--syntax-string)" },
  { tag: t.regexp, color: "var(--syntax-regexp)" },
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: "var(--syntax-keyword)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syntax-primitive)" },
  { tag: [t.operator, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: "var(--syntax-operator)" },
  { tag: [t.variableName, t.self], color: "var(--syntax-variable)" },
  { tag: [t.propertyName, t.attributeName], color: "var(--syntax-property)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--syntax-type)" },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], color: "var(--syntax-constant)" },
  { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.paren], color: "var(--syntax-punctuation)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syntax-object)" },
  { tag: [t.definitionKeyword, t.definition(t.variableName)], color: "var(--syntax-variable)" },
  { tag: t.invalid, color: "var(--syntax-critical)" },
  { tag: [t.heading, t.strong], color: "var(--syntax-keyword)", fontWeight: "bold" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.link, t.url], color: "var(--syntax-info)", textDecoration: "underline" },
])
