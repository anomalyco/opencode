import { WebSearchExa } from "./exa.js"
import { WebSearchFirecrawl } from "./firecrawl.js"
import { WebSearchLinkup } from "./linkup.js"
import { WebSearchParallel } from "./parallel.js"
import { WebSearchTavily } from "./tavily.js"
import { WebSearchTinyFish } from "./tinyfish.js"

export const WebSearchPlugins = [
  WebSearchExa.Plugin,
  WebSearchFirecrawl.Plugin,
  WebSearchLinkup.Plugin,
  WebSearchParallel.Plugin,
  WebSearchTavily.Plugin,
  WebSearchTinyFish.Plugin,
] as const
