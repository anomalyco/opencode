/** The review pane's selectors. Diff lines live in the diff viewer's shadow root, which `>>>` crosses. */
export const review = {
  /** Opens or closes the side panel, which shows its tab launcher until a tab is open. */
  toggle: 'button[aria-label="Toggle review"]',
  /** The review tab's shortcut (`review.open`), which opens the panel on the review. */
  shortcut: process.platform === "darwin" ? "Control+Meta+r" : "Control+Alt+r",
  file: '#review-panel [data-slot="session-review-v2-file-header"]',
  filter: '#review-panel [data-slot="session-review-v2-sidebar-filter"] input',
  next: '#review-panel button[aria-label="Next file"]',
  previous: '#review-panel button[aria-label="Previous file"]',
  line: '#review-panel [data-component="file"][data-mode="diff"] diffs-container >>> [data-line]',
  /** The file tree once it holds `rows` rows, folders included. */
  tree: (rows: number) => `#review-panel [data-component="file-tree-v2"][data-total-rows="${rows}"]`,
}

/** The part of strobe's page driver these helpers use. */
type Driver = {
  eval<T>(fn: () => T): Promise<T>
  press(key: string, opts?: { until?: string; timeout?: number }): Promise<void>
}

/** Opens the review unless it shows a file already; resolves once it does. */
export async function openReview(page: Driver) {
  const open = await page.eval(
    () =>
      document
        .querySelector('#review-panel [data-slot="session-review-v2-file-header"]')
        ?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ?? false,
  )

  if (open) return
  await page.press(review.shortcut, { until: review.file, timeout: 120_000 })
}
