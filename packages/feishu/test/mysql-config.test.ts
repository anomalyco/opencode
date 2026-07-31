import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadMysqlPassword, parseMysqlConfig } from "../src/mysql-config"

const valid = {
  FEISHU_MYSQL_HOST: "127.0.0.1",
  FEISHU_MYSQL_PORT: "3306",
  FEISHU_MYSQL_DATABASE: "t1_full_20260717_133707",
  FEISHU_MYSQL_USER: "inventory_reader",
  FEISHU_MYSQL_PASSWORD_FILE: "D:\\secrets\\mysql-password",
}
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("MySQL inventory configuration", () => {
  test("parses bounded MySQL-only defaults", () => {
    expect(parseMysqlConfig(valid)).toEqual({
      host: "127.0.0.1",
      port: 3306,
      database: "t1_full_20260717_133707",
      user: "inventory_reader",
      passwordFile: "D:\\secrets\\mysql-password",
      connectTimeoutMs: 5_000,
      queryTimeoutMs: 5_000,
      maxResults: 20,
    })
  })

  test("reports only a missing field name", () => {
    expect(() => parseMysqlConfig({ ...valid, FEISHU_MYSQL_USER: undefined })).toThrow("FEISHU_MYSQL_USER")
  })

  test.each([
    ["FEISHU_MYSQL_PORT", "0"],
    ["FEISHU_MYSQL_QUERY_TIMEOUT_MS", "60001"],
    ["FEISHU_MYSQL_MAX_RESULTS", "101"],
  ])("rejects invalid bounded value %s", (key, value) => {
    expect(() => parseMysqlConfig({ ...valid, [key]: value })).toThrow(key)
  })

  test("does not recognize a SQL Server fallback field", () => {
    expect(
      parseMysqlConfig({
        ...valid,
        T1_SQLSERVER_PASSWORD: "must-not-be-read",
      }),
    ).toEqual(parseMysqlConfig(valid))
  })

  test("loads and trims the password from the controlled file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "feishu-mysql-config-"))
    temporaryDirectories.push(directory)
    const passwordFile = path.join(directory, "password")
    await Bun.write(passwordFile, "local-secret\r\n")

    expect(await loadMysqlPassword({ ...parseMysqlConfig(valid), passwordFile })).toBe("local-secret")
  })

  test("does not expose an empty password file path", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "feishu-mysql-config-"))
    temporaryDirectories.push(directory)
    const passwordFile = path.join(directory, "private-password")
    await Bun.write(passwordFile, "\r\n")

    const error = await loadMysqlPassword({ ...parseMysqlConfig(valid), passwordFile }).catch((value) => value)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("FEISHU_MYSQL_PASSWORD_FILE is empty")
    expect((error as Error).message).not.toContain(passwordFile)
  })

  test("does not expose a missing password file path", async () => {
    const passwordFile = path.join(tmpdir(), "missing-feishu-mysql-password")
    const error = await loadMysqlPassword({ ...parseMysqlConfig(valid), passwordFile }).catch((value) => value)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("FEISHU_MYSQL_PASSWORD_FILE cannot be read")
    expect((error as Error).message).not.toContain(passwordFile)
  })
})
