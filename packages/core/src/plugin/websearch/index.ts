import { WebSearchExa } from "./exa.js"
import { WebSearchFirecrawl } from "./firecrawl.js"
import { WebSearchKeenable } from "./keenable.js"
import { WebSearchParallel } from "./parallel.js"
import { WebSearchTavily } from "./tavily.js"

export const WebSearchPlugins = [
  WebSearchExa.Plugin,
  WebSearchFirecrawl.Plugin,
  WebSearchKeenable.Plugin,
  WebSearchParallel.Plugin,
  WebSearchTavily.Plugin,
] as const
