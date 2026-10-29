// The first launch a new user sees, as ordered invariants. The recorder checks each one against the real
// packaged app and stops at the first that fails, so the video always ends on the step that broke.
//
// `from` names the moment the budget starts: an earlier invariant passing, or a recorder action.
// Budgets are generous on purpose: they catch a step that never happens, not a slow machine.

export const INVARIANTS = [
  {
    id: "window",
    title: "The app window opens",
    why: "Nothing else matters if the app does not start.",
    from: "launch",
    budgetMs: 60_000,
  },
  {
    id: "splash",
    title: "The first-launch splash draws the wordmark",
    why: "The first thing a new user sees. The plain loading splash means the app did not treat this as a first launch.",
    from: "window",
    budgetMs: 30_000,
  },
  {
    id: "new-session",
    title: "The splash hands off straight to the new session page",
    why: "A new user starts on a ready composer, not on Home, an empty project list or an error.",
    from: "splash",
    budgetMs: 90_000,
  },
  {
    id: "composer-focus",
    title: "The composer has focus without a click",
    why: "A new user can type straight away.",
    from: "new-session",
    budgetMs: 5_000,
  },
  {
    id: "free-model",
    title: "A model is selected without signing in",
    why: "The free OpenCode models work without an account, so sending needs no setup.",
    from: "new-session",
    budgetMs: 60_000,
  },
  {
    id: "prompt-sent",
    title: "Typing and pressing Enter sends the prompt",
    why: "The first message must leave the composer and open the session.",
    from: "enter",
    budgetMs: 30_000,
  },
  {
    id: "working",
    title: "The session shows that it is working",
    why: "The user sees that something is happening while the model starts.",
    from: "enter",
    budgetMs: 30_000,
  },
  {
    id: "reply",
    title: "The model replies",
    why: "The first answer arrives: the product works end to end without an account.",
    from: "enter",
    budgetMs: 180_000,
  },
] as const

export type InvariantID = (typeof INVARIANTS)[number]["id"]

export type Outcome = {
  id: InvariantID
  status: "passed" | "failed" | "skipped"
  /** Milliseconds since launch when the invariant passed or failed. */
  at?: number
  detail?: string
}
