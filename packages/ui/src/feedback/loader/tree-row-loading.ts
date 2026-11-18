/**
 * CSS for a `@pierre/trees` shadow root that draws a delayed, fading-in loader after the name of each folder row in
 * `paths`, as the tree writes them in `data-item-path` (a folder ends in "/"). It matches `Loader delayed`: the tree
 * renders its rows in its shadow root, where the loader's own CSS does not reach. Empty when nothing is loading.
 */
export function treeRowLoadingCss(paths: readonly string[]) {
  if (paths.length === 0) return ""

  const rows = paths
    .map((path) => `button[data-item-path="${CSS.escape(path)}"] > [data-item-section="content"]::after`)
    .join(",\n")

  return `
${rows} {
  content: "";
  display: inline-block;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  margin-inline-start: 6px;
  vertical-align: -2px;
  border: 1.5px solid color-mix(in srgb, var(--v2-icon-icon-muted, currentColor) 20%, transparent);
  border-top-color: var(--v2-icon-icon-muted, currentColor);
  border-radius: 50%;
  opacity: 0;
  animation:
    tree-row-loading-spin 900ms linear infinite,
    tree-row-loading-fade-in 200ms ease-out 150ms forwards;
}
@keyframes tree-row-loading-spin {
  to { transform: rotate(360deg); }
}
@keyframes tree-row-loading-fade-in {
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  ${rows} {
    animation: tree-row-loading-fade-in 200ms ease-out 150ms forwards;
  }
}
`
}
