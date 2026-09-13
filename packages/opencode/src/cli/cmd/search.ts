import type { CommandModule } from "yargs"
import { RetrievalEngine } from "@opencode-ai/knowledge-engine"
import { UI, Style } from "../ui"

interface SearchArgs {
  query: string
  type?: string
  stage?: number
  topK?: number
}

export const SearchCommand = {
  command: "search <query>",
  describe: "🔍 search the local embedded knowledge base",
  builder: (yargs) =>
    yargs
      .positional("query", {
        describe: "search query or topic",
        type: "string",
        demandOption: true,
      })
      .option("type", {
        alias: "t",
        describe: "content type (lesson, prompt, practice, troubleshooting)",
        type: "string",
        choices: ["lesson", "prompt", "practice", "troubleshooting"],
      })
      .option("stage", {
        alias: "s",
        describe: "educational stage (1-5)",
        type: "number",
      })
      .option("topK", {
        alias: "k",
        describe: "number of results to return",
        type: "number",
        default: 5,
      }),
  handler: async (args) => {
    const retriever = new RetrievalEngine()
    UI.println(`${Style.TEXT_HIGHLIGHT}\n🔍 جاري البحث عن: "${args.query}"\n${Style.TEXT_NORMAL}`)

    const results = await retriever.search(args.query, {
      topK: args.topK,
      type: args.type as any,
      stage: args.stage,
    })

    if (results.length === 0) {
      UI.println(`${Style.TEXT_WARNING}❌ لم أجد نتائج. جرّب كلمات أخرى.\n${Style.TEXT_NORMAL}`)
      return
    }

    UI.println(`${Style.TEXT_SUCCESS_BOLD}✅ وجدت ${results.length} نتيجة:\n${Style.TEXT_NORMAL}`)

    results.forEach((result, i) => {
      UI.println(`${Style.TEXT_HIGHLIGHT_BOLD}${i + 1}. ${result.title}${Style.TEXT_NORMAL}`)
      UI.println(
        `${Style.TEXT_DIM}   القسم: ${result.section} | النوع: ${result.type} | المرحلة: ${result.stage} | تطابق: ${(result.similarity * 100).toFixed(0)}%${Style.TEXT_NORMAL}`
      )
      UI.println(`${Style.TEXT_DIM}   المصدر: ${result.source}${Style.TEXT_NORMAL}`)
      const snippet = result.content.length > 300 ? result.content.substring(0, 300) + "..." : result.content
      UI.println(`\n   ${snippet}\n`)
    })

    UI.println(
      `${Style.TEXT_DIM}💡 هل تريد استخدام هذه المعرفة؟ يمكنك توجيه الوكيل الذكي: opencode-agent "${args.query}"\n${Style.TEXT_NORMAL}`
    )
  },
} satisfies CommandModule<object, SearchArgs>
