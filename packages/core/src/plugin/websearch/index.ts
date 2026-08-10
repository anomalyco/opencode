import { WebSearchExa } from "./exa"
import { WebSearchFirecrawl } from "./firecrawl"
import { WebSearchParallel } from "./parallel"

export const WebSearchPlugins = [WebSearchExa.Plugin, WebSearchFirecrawl.Plugin, WebSearchParallel.Plugin] as const
