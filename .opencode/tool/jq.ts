import z from "zod"
import { $ } from "bun"

/**
 * jq - JSON processor
 * Query, filter, and transform JSON data.
 */
export default {
  description: "JSON processor. Query, filter, and transform JSON data. Examples: 'jq .items[]' extracts array items, 'jq .items[].id' gets all IDs, 'jq \".name, .age\"' selects fields. Use isFile=true for file paths.",
  args: {
    filter: z.string().describe("jq filter expression (e.g., '.items[].id')"),
    input: z.string().describe("JSON input string or file path"),
    isFile: z.boolean().optional().describe("Is input a file path?"),
  },
  execute: async (params: { filter: string; input: string; isFile?: boolean }) => {
    let result: string
    
    if (params.isFile) {
      result = await $`jq ${params.filter} ${params.input}`.quiet().nothrow().text()
    } else {
      result = await $`echo ${params.input} | jq ${params.filter}`.quiet().nothrow().text()
    }
    
    return result || "No result"
  },
}
