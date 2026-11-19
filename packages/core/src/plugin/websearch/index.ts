import { WebSearchExa } from "./exa.js"
import { WebSearchFirecrawl } from "./firecrawl.js"
import { WebSearchJevlin } from "./jevlin.js"
import { WebSearchParallel } from "./parallel.js"
import { WebSearchTavily } from "./tavily.js"
import { WebSearchTinyFish } from "./tinyfish.js"

export const WebSearchPlugins = [
  WebSearchExa.Plugin,
  WebSearchFirecrawl.Plugin,
  WebSearchJevlin.Plugin,
  WebSearchParallel.Plugin,
  WebSearchTavily.Plugin,
  WebSearchTinyFish.Plugin,
] as const
