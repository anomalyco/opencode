import type { FileDiffInfo } from "@opencode/client/promise"
import { Contract } from "./core.js"
import type { SessionRef, SessionScreen } from "./host-apis.js"

/**
 * How a file or directory changed.
 * - `add`: added.
 * - `del`: deleted.
 * - `mix`: modified, or a directory whose files changed in more than one way.
 */
export type ChangeKind = "add" | "del" | "mix"

/** The routed session's changes as the review panel shows them. Empty for other sessions. */
export interface Changes {
  /**
   * The current review mode's diffs, empty until they load. Reactive.
   *
   * @param session - The session to read.
   * @returns The diffs.
   */
  diffs(session: SessionRef): readonly FileDiffInfo[]
  /**
   * False while the current mode's diffs load.
   *
   * @param session - The session to read.
   * @returns Whether the diffs loaded.
   */
  ready(session: SessionRef): boolean
  /**
   * The change kind of each changed file and each of its directories, keyed by normalized path.
   *
   * @param session - The session to read.
   * @returns The kinds by path.
   */
  kinds(session: SessionRef): ReadonlyMap<string, ChangeKind>
  /**
   * The file the review panel shows.
   *
   * @param session - The session to read.
   * @returns Its path, or undefined when the panel shows none.
   */
  active(session: SessionRef): string | undefined
  /**
   * The session directory's uncommitted changes, independent of the review mode (the session details' changes row).
   * Loads only while a `details` watch holds; undefined until loaded, empty when the load fails.
   *
   * @param session - The session to read.
   * @returns The uncommitted changes.
   */
  details(session: SessionRef): readonly FileDiffInfo[] | undefined
  /**
   * Opens the side region and shows `path` in the review panel.
   *
   * @param session - The session whose panel shows it.
   * @param path - The changed file's path.
   */
  focus(session: SessionRef, path: string): void
  /**
   * Shows the changes: opens the side region, or on narrow screens switches to the Changes view.
   *
   * @param session - The session whose changes show.
   */
  open(session: SessionRef): void
  /**
   * Keeps the changes of the view the caller renders loaded while it shows them, across the view's session
   * switches. A `tree` is a persistent change list: opening the side region refreshes the changes it shows.
   * `details` loads `details(session)`.
   *
   * @param screen - The owning screen from the panel or session-slot input, available even before publication.
   * @param source - The view's demand: a tree, file markers or session details.
   */
  watch(screen: SessionScreen, source: "tree" | "files" | "details"): () => void
}

/** The review plugin provides this. The session details' changes row reads the same data. */
export const Changes = Contract.define<Changes, "review.changes">("review.changes")
