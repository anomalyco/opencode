import { Context, Effect, Layer, Option } from "effect"
import { AppFileSystem } from "@yunpat/core/filesystem"
import { Config } from "@/config/config"
import path from "path"
import { Global } from "@yunpat/core/global"
import { Database } from "bun:sqlite"

export interface TrademarkRecord {
  markName: string
  applicant: string
  status: string
  niceClass: number
  goodsServices: string
}

export interface TrademarkAnalysis {
  distinctiveness: "强" | "中" | "弱" | "无"
  similarityScore: number
  confusionRisk: "高" | "中" | "低" | "无"
  reasons: string[]
}

export interface Interface {
  readonly search: (query: {
    markName?: string
    niceClass?: number
    applicant?: string
    limit?: number
  }) => Effect.Effect<TrademarkRecord[]>
  readonly analyzeSimilarity: (
    target: string,
    reference: string,
  ) => Effect.Effect<TrademarkAnalysis>
  readonly analyzeDistinctiveness: (markName: string, goodsServices: string) => Effect.Effect<TrademarkAnalysis>
}

export class Service extends Context.Service<Service, Interface>()("@yunpat/Trademark") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const config = yield* Config.Service

    const getDataDir = Effect.fnUntraced(function* () {
      const cfg = yield* config.get()
      return cfg.patent?.dataDir ?? path.join(Global.Path.data, "patent")
    })

    const search = Effect.fn("Trademark.search")(
      function* (query: {
        markName?: string
        niceClass?: number
        applicant?: string
        limit?: number
      }) {
        const dataDir = yield* getDataDir()
        const dbPath = path.join(dataDir, "trademark.db")
        const exists = yield* fs.existsSafe(dbPath)
        if (!exists) return []

        const results = yield* Effect.gen(function* () {
          const db = yield* Effect.acquireRelease(
            Effect.sync(() => new Database(dbPath, { readonly: true })),
            (db) => Effect.sync(() => db.close()),
          )
          const conditions: string[] = []
          const params: (string | number)[] = []
          if (query.markName) {
            conditions.push("markName LIKE ?")
            params.push(`%${query.markName}%`)
          }
          if (query.niceClass) {
            conditions.push("niceClass = ?")
            params.push(query.niceClass)
          }
          if (query.applicant) {
            conditions.push("applicant LIKE ?")
            params.push(`%${query.applicant}%`)
          }
          const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
          const limit = Math.min(query.limit ?? 10, 100)
          return db
            .query(`SELECT markName, applicant, status, niceClass, goodsServices FROM trademarks ${where} LIMIT ${limit}`)
            .all(...params) as Record<string, unknown>[]
        }).pipe(Effect.scoped)

        return results.map((row) => ({
          markName: String(row.markName ?? ""),
          applicant: String(row.applicant ?? ""),
          status: String(row.status ?? ""),
          niceClass: Number(row.niceClass ?? 0),
          goodsServices: String(row.goodsServices ?? ""),
        }))
      },
    )

    const analyzeSimilarity = Effect.fn("Trademark.analyzeSimilarity")(
      function* (target: string, reference: string) {
        const t = target.toLowerCase().replace(/\s/g, "")
        const r = reference.toLowerCase().replace(/\s/g, "")
        let overlap = 0
        for (let i = 0; i < Math.min(t.length, r.length); i++) {
          if (t[i] === r[i]) overlap++
        }
        const similarityScore = Math.max(t.length, r.length) > 0
          ? overlap / Math.max(t.length, r.length)
          : 0

        const reasons: string[] = []
        if (t === r) reasons.push("商标完全相同")
        else if (t.includes(r) || r.includes(t)) reasons.push("商标存在包含关系")
        else if (similarityScore > 0.5) reasons.push("商标高度相似")

        const confusionRisk = similarityScore > 0.7 ? "高" as const : similarityScore > 0.4 ? "中" as const : similarityScore > 0.2 ? "低" as const : "无" as const

        return {
          distinctiveness: confusionRisk === "高" ? "无" as const : confusionRisk === "中" ? "弱" as const : confusionRisk === "低" ? "中" as const : "强" as const,
          similarityScore: Number(similarityScore.toFixed(2)),
          confusionRisk,
          reasons,
        }
      },
    )

    const analyzeDistinctiveness = Effect.fn("Trademark.analyzeDistinctiveness")(
      function* (markName: string, _goodsServices: string) {
        const reasons: string[] = []
        let score = 0.7

        if (/^[A-Z]{2,5}$/.test(markName)) {
          score += 0.1
          reasons.push("字母组合商标，固有显著性较强")
        }
        if (/^[\u4e00-\u9fa5]{2,4}$/.test(markName)) {
          score += 0.05
          reasons.push("中文短商标，需结合商品判断显著性")
        }
        if (/(?:科技|技术|集团|有限公司)/.test(markName)) {
          score -= 0.3
          reasons.push("包含行业通用词汇，显著性较弱")
        }
        if (markName.length <= 2) {
          score -= 0.1
          reasons.push("两字商标审查较严，近似风险高")
        }

        score = Math.max(0, Math.min(1, score))
        const distinctiveness = score > 0.7 ? "强" as const : score > 0.4 ? "中" as const : score > 0.2 ? "弱" as const : "无" as const

        return {
          distinctiveness,
          similarityScore: score,
          confusionRisk: "无" as const,
          reasons,
        }
      },
    )

    return Service.of({ search, analyzeSimilarity, analyzeDistinctiveness })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Config.defaultLayer),
)

export * as Trademark from "./trademark"
