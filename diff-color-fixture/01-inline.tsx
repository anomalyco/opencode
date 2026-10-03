// BEGIN: baseline — first-line change
type ReviewState = "pending" | "ready" | "failed"
type ReviewProps = { title: string; count: number; state: ReviewState }

export const heading = "Review the old checkout experience"
export const count = 8
export const obsolete = "delete this isolated row"
export const anchor = "unchanged between deletion and addition"

// Contiguous span versus several separated small spans.
export const contiguous = "Keep the original checkout message readable"
export const scattered = "alpha: old; beta: cold; gamma: slow"
export const oneCharacter = "item-7"
export const atStart = "before middle remains ending remains"
export const atMiddle = "start remains before ending remains"
export const atEnd = "start remains middle remains before"
export const punctuation = { label: "Ready", enabled: true }
export const spaces = "one two three"
export const indent = "indent-only change"
export const trailing = "trailing-space-only change"

// Syntax competition: comment, keyword, type, boolean, string, number.
export function ReviewCard(props: ReviewProps) {
  const status: ReviewState = "pending"
  const enabled = false
  const retries = 3
  // Keep this quiet explanation readable on a tinted row.
  return <section aria-label="Old review" data-state={status}>
    <h2>{props.title}</h2>
    <span className="text-muted">{props.count} old items</span>
    <button disabled={!enabled}>Continue checkout</button>
  </section>
}

export const longLine = "Start unchanged | The old checkout flow waits for manual confirmation before showing the receipt | Middle unchanged with punctuation: brackets [one, two], braces {three}, quotes 'four', slash /five/ | The old final instruction asks the reviewer to close the window | End unchanged"

// END: baseline — last-line change
