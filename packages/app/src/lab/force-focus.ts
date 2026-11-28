// Story-only. Focus rings only show while an element matches :focus-visible, and only one element can. To show many at
// once, this copies each stylesheet rule that mentions :focus, :focus-visible or :focus-within into a lab-only sheet,
// with those pseudo-classes replaced by [data-lab-focus] (and :focus-within by the attribute on the element or a
// descendant). Marked elements then render with the production declarations and their real cascade layer, specificity
// and context. Browser default rings (an element with no authored focus rule) are not copied.

const focusable =
  'button:not(:disabled), input:not(:disabled), textarea, select, a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** Adds the lab copy of every focus rule and returns the function that removes it. */
export function forceFocusStyles() {
  const style = document.createElement("style")

  style.dataset.labForceFocus = ""
  style.textContent = [...document.styleSheets]
    .filter((sheet) => !sheet.href || new URL(sheet.href).origin === location.origin)
    .flatMap((sheet) => focusRules(sheet.cssRules))
    .join("\n")
  document.head.append(style)

  return () => style.remove()
}

/** The element a `[data-focus-specimen]` focuses: its `data-focus-target` selector, else its first focusable. */
export function focusTarget(specimen: HTMLElement) {
  return specimen.dataset.focusTarget
    ? specimen.querySelector<HTMLElement>(specimen.dataset.focusTarget)
    : specimen.querySelector<HTMLElement>(focusable)
}

// Copies the rules that style focus, keeping the @layer, @media and nesting they sit in.
function focusRules(rules: CSSRuleList): string[] {
  return [...rules].flatMap((rule) => {
    if (!rule.cssText.includes(":focus")) return []

    if (rule instanceof CSSStyleRule && rule.selectorText.includes(":focus")) return [forceFocus(rule.cssText)]

    if (rule instanceof CSSStyleRule) return [`${rule.selectorText} { ${focusRules(rule.cssRules).join("\n")} }`]

    if (rule instanceof CSSGroupingRule)
      return [`${rule.cssText.slice(0, rule.cssText.indexOf("{"))} { ${focusRules(rule.cssRules).join("\n")} }`]

    return []
  })
}

function forceFocus(css: string) {
  return css
    .replaceAll(":focus-within", ":is([data-lab-focus], :has([data-lab-focus]))")
    .replaceAll(":focus-visible", "[data-lab-focus]")
    .replace(/:focus(?![-\w])/g, "[data-lab-focus]")
}
