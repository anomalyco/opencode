import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Build a Wildberries product page URL for a known numeric article ID. Does not check the listing.",
  args: {
    article: tool.schema.string().regex(/^[1-9][0-9]{0,14}$/).describe("Wildberries article ID, as digits"),
  },
  async execute({ article }) {
    const url = `https://www.wildberries.ru/catalog/${article}/detail.aspx`

    return JSON.stringify({
      status: "success",
      summary: `Product page URL for article ${article}`,
      next_actions: [],
      artifacts: [url],
    })
  },
})
