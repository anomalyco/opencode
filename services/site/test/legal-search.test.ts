import { expect, test } from "bun:test"
import legalSearch from "~/component/site/legal-search.json"
import { legalSearch as entries } from "~/lib/legal-documents"

// The ⌘K search reads these instead of the legal documents (search-index.ts), so they must match
// the documents. Regenerate with `bun script/legal-search.ts`.
test("legal-search.json matches the legal documents", () => {
  expect(legalSearch).toEqual(entries())
})
