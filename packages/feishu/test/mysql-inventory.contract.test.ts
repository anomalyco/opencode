import { expect, test } from "bun:test"
import { createMysqlInventory } from "../src/mysql-inventory"
import { parseMysqlConfig } from "../src/mysql-config"

const enabled = process.env.FEISHU_MYSQL_CONTRACT === "1"

test.skipIf(!enabled)("reads the approved migrated MySQL contract", async () => {
  const inventory = await createMysqlInventory(parseMysqlConfig(process.env))
  try {
    expect(inventory.preflight.mysqlVersion).toStartWith("8.4.")
    expect(inventory.preflight.contractVersion).toBe("mysql-inventory-v1")

    const items = await inventory.query("6001ZZ")
    expect(items.some((item) => item.name === "6001ZZ")).toBeTrue()
    expect(items.some((item) => item.inventory === "200")).toBeTrue()
    expect(JSON.stringify(items)).not.toMatch(/SP\d+|u_Code|productID|s_ID/)
  } finally {
    await inventory.close()
  }
})
