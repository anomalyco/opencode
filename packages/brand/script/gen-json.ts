// 由 src/index.ts（唯一事实源）生成 brands/<id>/brand.json 镜像（供 node 侧脚本 fs 读取）
import { BRANDS } from "../src/index"
import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
const here = dirname(import.meta.path)
for (const [id, brand] of Object.entries(BRANDS)) {
  const file = join(here, "..", "brands", id, "brand.json")
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(brand, null, 2) + "\n")
  console.log("wrote", file)
}
