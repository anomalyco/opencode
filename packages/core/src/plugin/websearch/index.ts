import { WebSearchExa } from "./exa.js"
import { WebSearchFirecrawl } from "./firecrawl.js"
import { WebSearchParallel } from "./parallel.js"
import { WebSearchScrapeDo } from "./scrapedo.js"
import { WebSearchTavily } from "./tavily.js"
import { WebSearchTinyFish } from "./tinyfish.js"

export const WebSearchPlugins = [
  WebSearchExa.Plugin,
  WebSearchFirecrawl.Plugin,
  WebSearchParallel.Plugin,
  WebSearchScrapeDo.Plugin,
  WebSearchTavily.Plugin,
  WebSearchTinyFish.Plugin,
] as const
