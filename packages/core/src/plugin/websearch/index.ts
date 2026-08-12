import { WebSearchExa } from "./exa.js"
import { WebSearchFirecrawl } from "./firecrawl.js"
import { WebSearchParallel } from "./parallel.js"

export const WebSearchPlugins = [WebSearchExa.Plugin, WebSearchFirecrawl.Plugin, WebSearchParallel.Plugin] as const
