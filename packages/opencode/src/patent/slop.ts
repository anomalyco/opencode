import { Context, Effect, Layer } from "effect"
import { Config } from "@/config/config"

const SLOP_PHRASES = [
  "显而易见地", "不难发现", "值得一提的是", "毋庸置疑", "进一步地",
  "综上所述", "诚如前述", "恕我直言", "请允许我指出", "值得注意的是",
  "这是一个值得深思的问题", "需要指出的是", "正如大家所知",
  "创造性得以确立", "保护范围得以合理界定", "保护范围得以",
  "创造性障碍得以克服", "审查意见所指缺陷得以消除",
  "显著的进步", "质的飞跃", "革命性", "颠覆性",
  "全方位知识产权战略", "赋能", "闭环", "抓手", "深耕", "布局",
  "贯彻落实", "扎实推进",
]

const SLOP_PATTERNS = [
  { pattern: /不是.{2,20}问题[，,]而是.{2,20}问题/g, name: "二元假转折" },
  { pattern: /创造性.{0,5}得以.{1,6}[\n。]/g, name: "无主体宣告" },
  { pattern: /被(认为|视为|驳回|认可)/g, name: "被动语态隐藏主体" },
  { pattern: /本申请.{0,5}(具有|具备).{0,5}(新颖性|创造性|实用性)/g, name: "空泛结论" },
  { pattern: /建议.{0,10}(谨慎处理|高度重视|继续关注|持续关注)/g, name: "空洞建议" },
  { pattern: /以上分析仅供参考/g, name: "免责堆叠" },
]

export interface SlopIssue {
  type: "phrase" | "pattern" | "structure"
  matched: string
  suggestion: string
  severity: "high" | "medium" | "low"
}

export interface SlopReport {
  issues: SlopIssue[]
  score: number
  passed: boolean
  summary: string
}

export interface Interface {
  readonly detect: (content: string) => Effect.Effect<SlopReport>
  readonly filter: (content: string) => Effect.Effect<{ text: string; report: SlopReport }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SlopDetector") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const detect = Effect.fn("SlopDetector.detect")(function* (content: string) {
      const cfg = yield* config.get()
      const threshold = cfg.patent?.quality?.threshold ?? 6.0

      const issues: SlopIssue[] = []

      for (const phrase of SLOP_PHRASES) {
        let match: RegExpExecArray | null
        const regex = new RegExp(phrase, "g")
        while ((match = regex.exec(content)) !== null) {
          issues.push({
            type: "phrase",
            matched: match[0],
            suggestion: "删除此套话",
            severity: phrase.includes("得以") || phrase.includes("赋能") ? "high" : "medium",
          })
        }
      }

      for (const { pattern, name } of SLOP_PATTERNS) {
        let match: RegExpExecArray | null
        while ((match = pattern.exec(content)) !== null) {
          issues.push({
            type: "pattern",
            matched: match[0],
            suggestion: `重写（${name}）`,
            severity: "high",
          })
        }
      }

      const lines = content.split("\n")
      let sameStartCount = 0
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim().slice(0, 3) === lines[i - 1].trim().slice(0, 3) && lines[i].trim().length > 0) {
          sameStartCount++
        }
      }
      if (sameStartCount > 3) {
        issues.push({
          type: "structure",
          matched: `连续 ${sameStartCount} 句以相同词开头`,
          suggestion: "变换主语：权项、D1、申请人、审查员",
          severity: "medium",
        })
      }

      const highCount = issues.filter((i) => i.severity === "high").length
      const penalty = highCount * 1.5 + (issues.length - highCount) * 0.5
      const score = Math.max(0, 10 - penalty)
      const passed = score >= threshold

      const summary = issues.length === 0
        ? "未检测到 AI 套话"
        : `检测到 ${issues.length} 处套话（${highCount} 处高危），评分 ${score.toFixed(1)}`

      return { issues, score: Number(score.toFixed(1)), passed, summary }
    })

    const filter = Effect.fn("SlopDetector.filter")(function* (content: string) {
      const report = yield* detect(content)
      if (report.passed) return { text: content, report }

      let filtered = content
      for (const phrase of SLOP_PHRASES) {
        filtered = filtered.replaceAll(phrase, "")
      }
      filtered = filtered.replace(/\n{3,}/g, "\n\n").trim()

      const updatedReport = yield* detect(filtered)
      return { text: filtered, report: updatedReport }
    })

    return Service.of({ detect, filter })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export * as SlopDetector from "./slop"
