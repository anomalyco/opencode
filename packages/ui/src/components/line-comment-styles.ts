export const lineCommentStyles = `
[data-annotation-slot] {
  padding: 12px;
  box-sizing: border-box;
}

[data-component="line-comment"] {
  position: absolute;
  right: 24px;
  z-index: var(--line-comment-z, 30);
}

[data-component="line-comment"][data-inline] {
  position: relative;
  right: auto;
  display: flex;
  width: 100%;
  align-items: flex-start;
}

[data-component="line-comment"][data-open] {
  z-index: var(--line-comment-open-z, 100);
}

[data-component="line-comment"] [data-slot="line-comment-button"] {
  width: 20px;
  height: 20px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--icon-interactive-base);
  box-shadow: var(--shadow-xs);
  cursor: default;
  border: none;
}

[data-component="line-comment"][data-variant="add"] [data-slot="line-comment-button"] {
  background: var(--syntax-diff-add);
}

[data-component="line-comment"] [data-component="icon"] {
  color: var(--white);
}

[data-component="line-comment"] [data-slot="line-comment-icon"] {
  width: 12px;
  height: 12px;
  color: var(--white);
}

[data-component="line-comment"] [data-slot="line-comment-button"]:focus {
  outline: none;
}

[data-component="line-comment"] [data-slot="line-comment-button"]:focus-visible {
  box-shadow: var(--shadow-xs-border-focus);
}

[data-component="line-comment"] [data-slot="line-comment-popover"] {
  position: absolute;
  top: calc(100% + 4px);
  right: -8px;
  z-index: var(--line-comment-popover-z, 40);
  min-width: 200px;
  max-width: none;
  border-radius: 8px;
  background: var(--surface-raised-stronger-non-alpha);
  box-shadow: var(--shadow-xxs-border);
  padding: 12px;
}

[data-component="line-comment"][data-inline] [data-slot="line-comment-popover"] {
  position: relative;
  top: auto;
  right: auto;
  margin-left: 8px;
  flex: 0 1 600px;
  width: min(100%, 600px);
  max-width: min(100%, 600px);
}

[data-component="line-comment"][data-inline] [data-slot="line-comment-popover"][data-inline-body] {
  margin-left: 0;
}

[data-component="line-comment"][data-inline][data-variant="default"] [data-slot="line-comment-popover"][data-inline-body] {
  cursor: pointer;
}

[data-component="line-comment"][data-variant="editor"] [data-slot="line-comment-popover"] {
  width: 380px;
  max-width: none;
  padding: 8px;
  border-radius: 14px;
}

[data-component="line-comment"][data-inline][data-variant="editor"] [data-slot="line-comment-popover"] {
  flex-basis: 600px;
}

[data-component="line-comment"] [data-slot="line-comment-content"] {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

[data-component="line-comment"] [data-slot="line-comment-head"] {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

[data-component="line-comment"] [data-slot="line-comment-text"] {
  flex: 1;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-regular);
  line-height: var(--line-height-x-large);
  letter-spacing: var(--letter-spacing-normal);
  color: var(--text-strong);
  white-space: pre-wrap;
}

[data-component="line-comment"] [data-slot="line-comment-tools"] {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

[data-component="line-comment"] [data-slot="line-comment-label"],
[data-component="line-comment"] [data-slot="line-comment-editor-label"] {
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-large);
  letter-spacing: var(--letter-spacing-normal);
  color: var(--text-weak);
  white-space: nowrap;
}

[data-component="line-comment"] [data-slot="line-comment-editor"] {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

[data-component="line-comment"] [data-slot="line-comment-textarea"] {
  width: 100%;
  resize: vertical;
  padding: 8px;
  border-radius: var(--radius-md);
  background: var(--surface-base);
  border: 1px solid var(--border-base);
  color: var(--text-strong);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  line-height: var(--line-height-large);
}

[data-component="line-comment"] [data-slot="line-comment-textarea"]:focus {
  outline: none;
  box-shadow: var(--shadow-xs-border-select);
}

[data-component="line-comment"] [data-slot="line-comment-actions"] {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 8px;
}

[data-component="line-comment"] [data-slot="line-comment-editor-label"] {
  margin-right: auto;
}

[data-component="line-comment"] [data-slot="line-comment-action"] {
  border: 1px solid var(--border-base);
  background: var(--surface-base);
  color: var(--text-strong);
  border-radius: var(--radius-md);
  height: 28px;
  padding: 0 10px;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-medium);
}

[data-component="line-comment"] [data-slot="line-comment-action"][data-variant="ghost"] {
  background: transparent;
}

[data-component="line-comment"] [data-slot="line-comment-action"][data-variant="primary"] {
  background: var(--text-strong);
  border-color: var(--text-strong);
  color: var(--background-base);
}

[data-component="line-comment"] [data-slot="line-comment-action"]:disabled {
  opacity: 0.5;
  pointer-events: none;
}
`

let installed = false

export function installLineCommentStyles() {
  if (installed) return
  if (typeof document === "undefined") return

  const id = "opencode-line-comment-styles"
  if (document.getElementById(id)) {
    installed = true
    return
  }

  const style = document.createElement("style")
  style.id = id
  style.textContent = lineCommentStyles
  document.head.appendChild(style)
  installed = true
}
