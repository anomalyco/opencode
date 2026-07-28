import { WebSearchExa } from "./exa"
import { WebSearchParallel } from "./parallel"

export const WebSearchPlugins = [WebSearchExa.Plugin, WebSearchParallel.Plugin] as const
