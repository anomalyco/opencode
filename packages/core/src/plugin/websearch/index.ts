import { WebSearchBrave } from "./brave.js"
import { WebSearchExa } from "./exa.js"
import { WebSearchFirecrawl } from "./firecrawl.js"
import { WebSearchParallel } from "./parallel.js"
import { WebSearchTavily } from "./tavily.js"

export const WebSearchPlugins = [
  WebSearchBrave.Plugin,
  WebSearchExa.Plugin,
  WebSearchFirecrawl.Plugin,
  WebSearchParallel.Plugin,
  WebSearchTavily.Plugin,
] as const
