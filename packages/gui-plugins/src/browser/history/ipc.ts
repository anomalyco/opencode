import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/** An address as a page reports it; the history keeps only web pages of up to `MAX_URL_LENGTH`. */
const address = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16_384))

const Page = Schema.Struct({ url: address, title: Schema.String.check(Schema.isMaxLength(2_048)) })

/**
 * A page the address field may suggest. `score` is how often and how recently it was visited, which orders pages
 * that match equally well.
 */
export const HistoryPage = Schema.Struct({ url: Schema.String, title: Schema.String, score: Schema.Finite })

export type HistoryPage = typeof HistoryPage.Type

/**
 * The browsing history of this desktop app: the pages visited here and the pages imported from other browsers, in one
 * store in the main process, on this computer only. A window never holds it: it asks for the few pages that match
 * what the person typed. Only the windows' address field calls it; no tool of the agent reads or searches it.
 */
export const BrowserHistory = Ipc.define({
  id: "browser.history",
  methods: {
    /** The person focused the address field: main reads the history into memory, so the first search finds it there. */
    prepare: {},
    /** The `limit` pages that match the typed text best, best first. Text with no word to search for finds none. */
    search: {
      input: Schema.Struct({
        query: Schema.String.check(Schema.isMaxLength(2_048)),
        limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
      }),
      output: Schema.Array(HistoryPage),
    },
    /** A page finished loading in a tab: one more visit. A page that is not a web page is ignored. */
    visit: { input: Page },
    /** A page visited already reported its title. */
    retitle: { input: Page },
    /** The person removed a suggestion: its page is forgotten. */
    remove: { input: Schema.Struct({ url: address }) },
    /** Forgets every page, imported ones included. */
    clear: {},
  },
})
