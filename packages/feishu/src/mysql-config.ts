export type MysqlConfig = {
  host: string
  port: number
  database: string
  user: string
  passwordFile: string
  connectTimeoutMs: number
  queryTimeoutMs: number
  maxResults: number
}

export function parseMysqlConfig(env: Readonly<Record<string, string | undefined>>): MysqlConfig {
  return {
    host: required(env, "FEISHU_MYSQL_HOST"),
    port: integer(env, "FEISHU_MYSQL_PORT", 1, 65_535),
    database: required(env, "FEISHU_MYSQL_DATABASE"),
    user: required(env, "FEISHU_MYSQL_USER"),
    passwordFile: required(env, "FEISHU_MYSQL_PASSWORD_FILE"),
    connectTimeoutMs: optionalInteger(env, "FEISHU_MYSQL_CONNECT_TIMEOUT_MS", 5_000, 100, 60_000),
    queryTimeoutMs: optionalInteger(env, "FEISHU_MYSQL_QUERY_TIMEOUT_MS", 5_000, 100, 60_000),
    maxResults: optionalInteger(env, "FEISHU_MYSQL_MAX_RESULTS", 20, 1, 100),
  }
}

export async function loadMysqlPassword(config: MysqlConfig) {
  const password = (
    await Bun.file(config.passwordFile)
      .text()
      .catch(() => {
        throw new Error("FEISHU_MYSQL_PASSWORD_FILE cannot be read")
      })
  ).trim()
  if (!password) throw new Error("FEISHU_MYSQL_PASSWORD_FILE is empty")
  return password
}

function required(env: Readonly<Record<string, string | undefined>>, key: string) {
  const value = env[key]?.trim()
  if (!value) throw new Error(`${key} is required`)
  return value
}

function integer(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  minimum: number,
  maximum: number,
) {
  return boundedInteger(required(env, key), key, minimum, maximum)
}

function optionalInteger(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = env[key]?.trim()
  if (!value) return fallback
  return boundedInteger(value, key, minimum, maximum)
}

function boundedInteger(value: string, key: string, minimum: number, maximum: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} is invalid`)
  }
  return parsed
}
