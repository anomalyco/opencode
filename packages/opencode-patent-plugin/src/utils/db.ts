/**
 * PostgreSQL 数据库连接工具
 *
 * 连接本地 PostgreSQL 实例：
 * - patent_db: 7500万+ 中国专利数据
 * - legal_world_model: 法律世界模型（法规、规则、判决）
 */

import { Client } from "pg"

export interface DBConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
}

const DEFAULT_CONFIG: DBConfig = {
  host: process.env.PATENT_DB_HOST || "localhost",
  port: Number(process.env.PATENT_DB_PORT) || 5432,
  user: process.env.PATENT_DB_USER || "xujian",
  password: process.env.PATENT_DB_PASSWORD || "",
  database: "patent_db",
}

/**
 * 创建数据库客户端
 */
export function createClient(config?: Partial<DBConfig>): Client {
  return new Client({ ...DEFAULT_CONFIG, ...config })
}

/**
 * 执行查询并自动关闭连接
 */
export async function query<T = any>(
  sql: string,
  params?: any[],
  config?: Partial<DBConfig>,
): Promise<T[]> {
  const client = createClient(config)
  try {
    await client.connect()
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    await client.end()
  }
}

/**
 * 专利数据库查询
 */
export async function queryPatentDB<T = any>(sql: string, params?: any[]): Promise<T[]> {
  return query<T>(sql, params, { database: "patent_db" })
}

/**
 * 法律世界模型数据库查询
 */
export async function queryLegalModel<T = any>(sql: string, params?: any[]): Promise<T[]> {
  return query<T>(sql, params, { database: "legal_world_model" })
}

/**
 * 专利全文搜索
 */
export async function searchPatents(
  keyword: string,
  options: {
    limit?: number
    fields?: Array<"title" | "abstract" | "claims" | "applicant" | "inventor">
    patentType?: string
    ipcClass?: string
    dateFrom?: string
    dateTo?: string
  } = {},
): Promise<PatentRecord[]> {
  const {
    limit = 10,
    fields = ["title", "abstract", "claims"],
    patentType,
    ipcClass,
    dateFrom,
    dateTo,
  } = options

  const conditions: string[] = ["search_vector @@ plainto_tsquery('chinese', $1)"]
  const params: any[] = [keyword]
  let paramIdx = 2

  if (patentType) {
    conditions.push(`patent_type = $${paramIdx++}`)
    params.push(patentType)
  }
  if (ipcClass) {
    conditions.push(`ipc_main_class ILIKE $${paramIdx++}`)
    params.push(`%${ipcClass}%`)
  }
  if (dateFrom) {
    conditions.push(`application_date >= $${paramIdx++}`)
    params.push(dateFrom)
  }
  if (dateTo) {
    conditions.push(`application_date <= $${paramIdx++}`)
    params.push(dateTo)
  }

  const sql = `
    SELECT
      patent_name,
      application_number,
      publication_number,
      applicant,
      inventor,
      ipc_main_class,
      abstract,
      claims,
      application_date,
      patent_type,
      ts_rank(search_vector, plainto_tsquery('chinese', $1)) as relevance
    FROM patents
    WHERE ${conditions.join(" AND ")}
    ORDER BY relevance DESC
    LIMIT $${paramIdx}
  `
  params.push(limit)

  return queryPatentDB<PatentRecord>(sql, params)
}

/**
 * 专利记录类型
 */
export interface PatentRecord {
  patent_name: string
  application_number: string
  publication_number: string
  applicant: string
  inventor: string
  ipc_main_class: string
  abstract: string
  claims: string
  application_date: string
  patent_type: string
  relevance: number
}

/**
 * 查询法规条文
 */
export async function searchLegalRules(
  keyword: string,
  options: {
    limit?: number
    articleType?: string
  } = {},
): Promise<LegalRule[]> {
  const { limit = 10, articleType } = options

  const conditions: string[] = ["content ILIKE $1 OR title ILIKE $1"]
  const params: any[] = [`%${keyword}%`]
  let paramIdx = 2

  if (articleType) {
    conditions.push(`article_type = $${paramIdx++}`)
    params.push(articleType)
  }

  const sql = `
    SELECT
      article_number,
      title,
      content,
      article_type,
      hierarchy_level,
      full_path,
      core_principle,
      key_requirements
    FROM patent_rules_unified
    WHERE ${conditions.join(" AND ")}
    ORDER BY hierarchy_level, article_number
    LIMIT $${paramIdx}
  `
  params.push(limit)

  return queryLegalModel<LegalRule>(sql, params)
}

/**
 * 法规条文类型
 */
export interface LegalRule {
  article_number: string
  title: string
  content: string
  article_type: string
  hierarchy_level: number
  full_path: string
  core_principle: string
  key_requirements: any
}

/**
 * 查询专利判决/案例
 */
export async function searchPatentJudgments(
  keyword: string,
  options: {
    limit?: number
    judgmentType?: string
  } = {},
): Promise<PatentJudgment[]> {
  const { limit = 10, judgmentType } = options

  const conditions: string[] = ["case_title ILIKE $1 OR case_summary ILIKE $1"]
  const params: any[] = [`%${keyword}%`]
  let paramIdx = 2

  if (judgmentType) {
    conditions.push(`judgment_type = $${paramIdx++}`)
    params.push(judgmentType)
  }

  const sql = `
    SELECT
      case_number,
      case_title,
      case_summary,
      judgment_type,
      court,
      judgment_date,
      legal_basis,
      patent_numbers
    FROM patent_judgments
    WHERE ${conditions.join(" AND ")}
    ORDER BY judgment_date DESC
    LIMIT $${paramIdx}
  `
  params.push(limit)

  return queryLegalModel<PatentJudgment>(sql, params)
}

/**
 * 专利判决类型
 */
export interface PatentJudgment {
  case_number: string
  case_title: string
  case_summary: string
  judgment_type: string
  court: string
  judgment_date: string
  legal_basis: string
  patent_numbers: string[]
}

/**
 * 获取专利详情
 */
export async function getPatentDetail(applicationNumber: string): Promise<PatentRecord | null> {
  const results = await queryPatentDB<PatentRecord>(
    `SELECT * FROM patents WHERE application_number = $1 LIMIT 1`,
    [applicationNumber],
  )
  return results[0] || null
}

/**
 * 获取法规详情
 */
export async function getLegalRule(articleNumber: string): Promise<LegalRule | null> {
  const results = await queryLegalModel<LegalRule>(
    `SELECT * FROM patent_rules_unified WHERE article_number = $1 LIMIT 1`,
    [articleNumber],
  )
  return results[0] || null
}
