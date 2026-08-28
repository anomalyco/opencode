---
"@opencode-ai/core": patch
"@opencode-ai/server": patch
---

Keep the live models.dev catalog independent of persistence so failed cache reads or writes cannot prevent model updates. Cache downloaded catalogs in local files on Bun and Node, and use the bundled snapshot plus in-memory refreshes on workerd instead of storing the catalog in each Durable Object's database. Explicit catalog files refresh locally without fetching or writing an implicit cache.
