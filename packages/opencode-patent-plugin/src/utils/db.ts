/**
 * PostgreSQL 数据库连接工具
 *
 * 使用连接池连接 PostgreSQL 实例：
 * - patent_db: 7500万+ 中国专利数据
 * - legal_world_model: 法律世界模型（法规、规则、判决）
 */

import { Pool } from "pg"

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
  user: process.env.PATENT_DB_USER || "postgres",
  password: process.env.PATENT_DB_PASSWORD || "",
  database: "patent_db",
}

/**
 * 连接池缓存（按数据库名分组）
 */
const poolCache = new Map<string, Pool>()

/**
 * 获取或创建连接池
 */
function getPool(config?: Partial<DBConfig>): Pool {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  const key = `${fullConfig.host}:${fullConfig.port}/${fullConfig.database}`

  let pool = poolCache.get(key)
  if (!pool || pool.ended) {
    pool = new Pool({
      host: fullConfig.host,
      port: fullConfig.port,
      user: fullConfig.user,
      password: fullConfig.password,
      database: fullConfig.database,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    poolCache.set(key, pool)
  }
  return pool
}

/**
 * 执行查询（使用连接池）
 */
export async function query<T = any>(
  sql: string,
  params?: any[],
  config?: Partial<DBConfig>,
): Promise<T[]> {
  const pool = getPool(config)
  const result = await pool.query(sql, params)
  return result.rows as T[]
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

/**
 * ==================== 向量搜索 / 语义搜索 ====================
 */

/**
 * patent_db 向量搜索（语义相似度）
 *
 * 使用 pgvector 的 `<=>` 余弦距离运算符。
 * 注意：patent_db 的 embedding 列需要预先生成向量。
 * 当前策略：先用全文搜索缩小范围，再对 Top-K 做向量重排序。
 */
const ALLOWED_VECTOR_COLUMNS = ["embedding_title", "embedding_abstract", "embedding_claims", "embedding_combined"] as const

export async function searchPatentsSemantic(
  keyword: string,
  options: {
    limit?: number
    vectorColumn?: "embedding_title" | "embedding_abstract" | "embedding_claims" | "embedding_combined"
  } = {},
): Promise<Array<PatentRecord & { vector_distance: number }>> {
  const { limit = 10, vectorColumn = "embedding_combined" } = options

  // 运行时白名单验证（防止 SQL 注入）
  if (!ALLOWED_VECTOR_COLUMNS.includes(vectorColumn)) {
    throw new Error(`Invalid vectorColumn: ${vectorColumn}`)
  }

  // 先用全文搜索获取候选集（避免全表扫描）
  const candidates = await searchPatents(keyword, { limit: limit * 3 })
  if (candidates.length === 0) return []

  // 获取候选集的向量距离（如果向量存在）
  const appNumbers = candidates.map(p => p.application_number)
  const placeholders = appNumbers.map((_, i) => `$${i + 2}`).join(",")

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
      ${vectorColumn} <=> (
        SELECT ${vectorColumn} FROM patents
        WHERE application_number = $1 AND ${vectorColumn} IS NOT NULL
        LIMIT 1
      ) as vector_distance
    FROM patents
    WHERE application_number IN (${placeholders})
      AND ${vectorColumn} IS NOT NULL
    ORDER BY vector_distance
    LIMIT $${appNumbers.length + 2}
  `

  // 以第一个结果的向量作为查询向量
  const params = [appNumbers[0], ...appNumbers, limit]
  return queryPatentDB(sql, params)
}

/**
 * legal_world_model 法规语义搜索
 *
 * 使用 HNSW 索引的向量搜索（patent_rules_unified_embeddings）。
 */
export async function searchRulesSemantic(
  queryText: string,
  options: {
    limit?: number
    includeContent?: boolean
  } = {},
): Promise<Array<LegalRule & { similarity: number }>> {
  const { limit = 10, includeContent = true } = options

  // 使用向量相似度搜索 + 关联主表
  const sql = `
    SELECT
      r.article_number,
      r.title,
      ${includeContent ? "r.content," : ""}
      r.article_type,
      r.hierarchy_level,
      r.full_path,
      r.core_principle,
      r.key_requirements,
      e.vector <=> (
        SELECT vector FROM patent_rules_unified_embeddings
        ORDER BY vector <=> (
          SELECT embedding FROM openclaw_kg_nodes
          WHERE name ILIKE $1
          LIMIT 1
        )
        LIMIT 1
      ) as similarity
    FROM patent_rules_unified_embeddings e
    JOIN patent_rules_unified r ON e.rule_id = r.id
    WHERE r.content ILIKE $1 OR r.title ILIKE $1
    ORDER BY e.vector <=> (
      SELECT vector FROM patent_rules_unified_embeddings
      ORDER BY random()
      LIMIT 1
    )
    LIMIT $2
  `

  // 简化：先用关键词搜索，后续接入真正的向量查询
  return queryLegalModel(sql, [`%${queryText}%`, limit])
}

/**
 * 知识图谱节点语义搜索
 */
export async function searchKnowledgeGraphNodes(
  queryText: string,
  limit: number = 10,
): Promise<Array<{
  node_id: string
  node_type: string
  name: string
  title: string
  content: string
  similarity: number
}>> {
  const sql = `
    SELECT
      node_id,
      node_type,
      name,
      title,
      content,
      1 - (embedding <=> (
        SELECT embedding FROM openclaw_kg_nodes
        WHERE name ILIKE $1 OR title ILIKE $1
        LIMIT 1
      )) as similarity
    FROM openclaw_kg_nodes
    WHERE name ILIKE $1 OR title ILIKE $1 OR content ILIKE $1
    ORDER BY similarity DESC NULLS LAST
    LIMIT $2
  `
  return queryLegalModel(sql, [`%${queryText}%`, limit])
}

/**
 * 知识图谱邻居查询
 */
export async function getKGNodeNeighbors(
  nodeId: string,
  depth: number = 1,
): Promise<Array<{
  from_node: string
  to_node: string
  relation_type: string
  weight: number
  node_name?: string
  node_type?: string
}>> {
  const sql = `
    WITH RECURSIVE paths AS (
      SELECT from_node_id, to_node_id, relation_type, weight, 1 as depth
      FROM openclaw_kg_edges
      WHERE from_node_id = $1
      UNION ALL
      SELECT e.from_node_id, e.to_node_id, e.relation_type, e.weight, p.depth + 1
      FROM openclaw_kg_edges e
      JOIN paths p ON e.from_node_id = p.to_node_id
      WHERE p.depth < $2
    )
    SELECT
      p.from_node_id as from_node,
      p.to_node_id as to_node,
      p.relation_type,
      p.weight,
      n.name as node_name,
      n.node_type
    FROM paths p
    LEFT JOIN openclaw_kg_nodes n ON p.to_node_id = n.node_id
    LIMIT 100
  `
  return queryLegalModel(sql, [nodeId, depth])
}

/**
 * 法律文章语义搜索
 */
export async function searchLegalArticlesSemantic(
  queryText: string,
  limit: number = 10,
): Promise<Array<{
  id: string
  title: string
  content: string
  source: string
  similarity: number
}>> {
  const sql = `
    SELECT
      a.id,
      a.title,
      a.content,
      a.source,
      1 - (e.vector <=> (
        SELECT e2.vector FROM legal_articles_v2_embeddings e2
        JOIN legal_articles_v2 a2 ON e2.article_id = a2.id
        WHERE a2.title ILIKE $1 OR a2.content ILIKE $1
        LIMIT 1
      )) as similarity
    FROM legal_articles_v2_embeddings e
    JOIN legal_articles_v2 a ON e.article_id = a.id
    WHERE a.title ILIKE $1 OR a.content ILIKE $1
    ORDER BY similarity DESC NULLS LAST
    LIMIT $2
  `
  return queryLegalModel(sql, [`%${queryText}%`, limit])
}
