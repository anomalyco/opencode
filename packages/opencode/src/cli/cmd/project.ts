import type { CommandModule } from "yargs"
import { RetrievalEngine } from "@opencode-ai/knowledge-engine"
import { UI, Style } from "../ui"
import { mkdirSync, writeFileSync } from "fs"
import path from "path"
import readline from "readline"

interface ProjectArgs {
  name: string
  type?: string
  difficulty?: string
}

export const ProjectCommand = {
  command: "project <name>",
  describe: "🎯 bootstrap a new project with embedded knowledge guidance",
  builder: (yargs) =>
    yargs
      .positional("name", {
        describe: "project directory name",
        type: "string",
        demandOption: true,
      })
      .option("type", {
        alias: "t",
        describe: "project domain/type (coding, writing, automation)",
        type: "string",
      })
      .option("difficulty", {
        alias: "d",
        describe: "difficulty level (easy, medium, hard)",
        type: "string",
      }),
  handler: async (args) => {
    const retriever = new RetrievalEngine()
    UI.println(`${Style.TEXT_HIGHLIGHT_BOLD}\n🎯 إنشاء مشروع جديد: ${args.name}\n${Style.TEXT_NORMAL}`)

    let projectType = args.type
    let difficulty = args.difficulty

    if (!projectType || !difficulty) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      if (!projectType) {
        projectType = await new Promise<string>((resolve) => {
          UI.println(`${Style.TEXT_SUCCESS}أنواع المشاريع:${Style.TEXT_NORMAL}`)
          UI.println("  1. 💻 برمجة (Coding)")
          UI.println("  2. ✍️ كتابة وتوثيق (Documentation)")
          UI.println("  3. 📊 أتمتة وتكامل (Automation)")
          rl.question(`${Style.TEXT_HIGHLIGHT}اختر نوع المشروع [1]: ${Style.TEXT_NORMAL}`, (ans) => {
            const types: Record<string, string> = {
              "1": "برمجة تطوير برمجيات Coding",
              "2": "توثيق وكتابة Documentation",
              "3": "أتمتة وسير عمل Automation",
            }
            resolve(types[ans.trim()] || types["1"])
          })
        })
      }

      if (!difficulty) {
        difficulty = await new Promise<string>((resolve) => {
          UI.println(`${Style.TEXT_SUCCESS}مستوى الصعوبة:${Style.TEXT_NORMAL}`)
          UI.println("  1. سهل (Beginner)")
          UI.println("  2. متوسط (Intermediate)")
          UI.println("  3. متقدم (Advanced)")
          rl.question(`${Style.TEXT_HIGHLIGHT}اختر المستوى [2]: ${Style.TEXT_NORMAL}`, (ans) => {
            const diffs: Record<string, string> = {
              "1": "سهل للمبتدئين",
              "2": "متوسط",
              "3": "متقدم ومعقد",
            }
            resolve(diffs[ans.trim()] || diffs["2"])
          })
        })
      }

      rl.close()
    }

    UI.println(
      `${Style.TEXT_DIM}\n⏳ جاري جمع أفضل الممارسات والتوجيهات من محرك المعرفة...\n${Style.TEXT_NORMAL}`
    )

    const guidanceResults = await retriever.search(`${projectType} ${difficulty}`, { topK: 5 })

    const projectDir = path.resolve(process.cwd(), args.name)
    mkdirSync(projectDir, { recursive: true })

    const guidanceBody = guidanceResults
      .map(
        (g, i) => `### ${i + 1}. ${g.title} (${g.section})
- **النوع:** ${g.type}
- **المصدر:** ${g.source}
- **درجة التطابق:** ${(g.similarity * 100).toFixed(0)}%

${g.content}
`
      )
      .join("\n---\n\n")

    const fileContent = `# 🎯 توجيهات مشروع: ${args.name}

- **النوع:** ${projectType}
- **المستوى:** ${difficulty}
- **تاريخ الإنشاء:** ${new Date().toISOString()}
- **مولد بواسطة:** OpenCode Knowledge Engine

---

## 📋 التوجيهات الهندسية وأفضل الممارسات المسترجعة

${guidanceBody}

---

## 🚀 كيفية البدء

\`\`\`bash
cd ${args.name}
opencode .
\`\`\`
`

    const guidancePath = path.join(projectDir, "GUIDANCE.md")
    writeFileSync(guidancePath, fileContent, "utf-8")

    UI.println(`${Style.TEXT_SUCCESS_BOLD}✅ تم إنشاء هيكل المشروع وتوجيهاته بنجاح:${Style.TEXT_NORMAL}`)
    UI.println(`   📁 ${projectDir}`)
    UI.println(`   📄 ${guidancePath}\n`)
    UI.println(`${Style.TEXT_HIGHLIGHT}🚀 الخطوة التالية:${Style.TEXT_NORMAL}`)
    UI.println(`   cd ${args.name}`)
    UI.println(`   opencode .\n`)
  },
} satisfies CommandModule<object, ProjectArgs>
