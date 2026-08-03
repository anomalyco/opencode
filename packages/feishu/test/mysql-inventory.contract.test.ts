import { expect, test } from "bun:test"
import { formatInventoryAnswer } from "../src/inventory-answer"
import { createMysqlInventory } from "../src/mysql-inventory"
import { parseMysqlConfig } from "../src/mysql-config"

const enabled = process.env.FEISHU_MYSQL_CONTRACT === "1"

test.skipIf(!enabled)(
  "reads the approved migrated MySQL contract",
  async () => {
    const inventory = await createMysqlInventory(parseMysqlConfig(process.env))
    try {
      expect(inventory.preflight.mysqlVersion).toStartWith("8.4.")
      expect(inventory.preflight.contractVersion).toBe("mysql-inventory-v2")
      expect(inventory.preflight.standardRunID).toBeTruthy()

      const items = await inventory.query("6001ZZ")
      expect(items.some((item) => item.name === "6001ZZ")).toBeTrue()
      const approved = items.find(
        (item) =>
          item.name === "6001ZZ" &&
          item.inventory === "177" &&
          item.supplier === "虎旺" &&
          item.remark === "2026-07-15" &&
          item.shelves.join(",") === "A-1-1,A-1-4,A-2-2,A-2-3",
      )
      expect(approved).toBeDefined()
      expect(formatInventoryAnswer([approved!])).toBe(
        "6001ZZ（12×28×8）（货架号：A-1-1、A-1-4、A-2-2、A-2-3）虎旺库存177，备注：2026-07-15",
      )
      expect(JSON.stringify(items)).not.toMatch(/SP\d+|u_Code|productID|s_ID/)
    } finally {
      await inventory.close()
    }
  },
  20_000,
)
