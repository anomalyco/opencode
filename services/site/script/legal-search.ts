// Writes src/component/site/legal-search.json, the ⌘K search's entries for the legal documents
// (legalSearch in lib/legal-documents.ts), so the search doesn't load the documents themselves. Run after
// changing a legal document; test/legal-search.test.ts fails while the file is out of date.
import path from "node:path"
import { legalSearch } from "../src/lib/legal-documents"

const file = path.join(import.meta.dir, "../src/component/site/legal-search.json")
await Bun.write(file, JSON.stringify(legalSearch(), null, 2) + "\n")
console.log(`legal-search.json: ${legalSearch().length} documents`)
