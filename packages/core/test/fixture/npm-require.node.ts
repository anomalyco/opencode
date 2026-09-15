import { createRequire } from "node:module"

// Other modules can require dependencies while the resolver awaits its import probe.
createRequire(import.meta.url)("node:path")
