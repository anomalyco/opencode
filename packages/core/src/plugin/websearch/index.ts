import { WebSearchExa } from "./exa.js"
import { WebSearchFirecrawl } from "./firecrawl.js"
import { WebSearchKeenable } from "./keenable.js"
import { WebSearchParallel } from "./parallel.js"
import { WebSearchTavily } from "./tavily.js"
import { WebSearchTinyFish } from "./tinyfish.js"

export const WebSearchPlugins = [
  WebSearchExa.Plugin,
  WebSearchFirecrawl.Plugin,
  WebSearchKeenable.Plugin,
  WebSearchParallel.Plugin,
  WebSearchTavily.Plugin,
  WebSearchTinyFish.Plugin,
] as const
