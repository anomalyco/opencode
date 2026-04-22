import { compress } from "./compress"
import { compressAgent } from "./compress-agent"
import { summary } from "./summary"
import { title } from "./title"
import { translateAgent } from "./translate-agent"

export const helperAgent = {
  compress,
  "compress-agent": compressAgent,
  summary,
  title,
  "translate-agent": translateAgent,
}
