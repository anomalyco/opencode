// FORK: 跑 sample md → 真实 .docx 文件落盘 — 让 user 用 Word 打开看渲染样式 2026-05-07
//
// 跑法:bun run --cwd packages/app scripts/dump-sample-docx.ts
// 输出:D:/tmp/deskfox-test-output/sample-export.docx
//
// 不依赖 Tauri 后端 — 直接 fs.writeFileSync 写盘。
// 跑的核心 docx 生成 pipeline 跟 exportMdAsDocx 一样:
//   markdown → markdownDocx → Packer → unzipSync → fork helper(merge / emoji)→ zipSync → writeFileSync

import markdownDocx, { Packer } from "@jinzhongjia/markdown-docx"
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate"
import { writeFileSync } from "node:fs"
import {
  mergeCodeBlockParagraphs,
  splitRunsForEmoji,
  base64ToBytes,
  bytesToBase64,
} from "../src/utils/md-export-docx"

const SAMPLE_MD = `# DeskFox MD → Word 转换演示

这是用 \`exportMdAsDocx\` 主入口流程生成的真实 docx 文件,你可以用 Word 打开看效果。

## 段落与格式化

普通段落,内含**粗体文字**和*斜体文字*以及 ~~删除线~~,以及 \`inline code\`。

> 这是引用块。
> 跨多行的引用。

## 列表

无序列表:
- 第一项
- 第二项,内含**粗体**
- 第三项,内含 \`inline code\`

有序列表:
1. 步骤一
2. 步骤二
3. 步骤三

任务列表:
- [x] 已完成项
- [ ] 待办项 1
- [ ] 待办项 2

## 代码块

\`\`\`typescript
// DeskFox MD 编辑器扩展
const greeting = "Hello, DeskFox!"
const items = [1, 2, 3, 4, 5]

function processItems(items: number[]): number {
  return items.reduce((sum, x) => sum + x, 0)
}

console.log(greeting, processItems(items))
\`\`\`

\`\`\`python
# 多语言代码块测试
def fibonacci(n):
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print([fibonacci(i) for i in range(10)])
\`\`\`

## 表格

| 功能 | 状态 | 备注 |
|---|---|---|
| MD 解析 | ✓ | marked 库 |
| 代码高亮 | ✓ | github-light theme |
| 表格渲染 | ✓ | docx 库自带 |
| 中文支持 | ✓ | UTF-8 全程 |

## Emoji 与特殊字符

Emoji 测试:Hello 😀 World 🎉 测试 ✓ 失败 ✗ 上箭头 ↑ 下箭头 ↓

国旗:🇨🇳 🇺🇸 🇯🇵

## 链接

外链:[DeskFox 主页](https://deskfox.ai) / [上游 opencode](https://github.com/anomalyco/opencode)

## 标题层级

### H3 三级标题

#### H4 四级标题

##### H5 五级标题

###### H6 六级标题

---

## 数学公式(库可能不支持,看渲染)

行内:$E = mc^2$

块级:
$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

---

**DeskFox MD → Word 演示文档结束**。

生成时间:${new Date().toISOString()}
`

async function main() {
  console.log("[dump] 开始生成 sample docx...")

  // 1. md → docx 文档对象(marked + docx@9.x + syntax 高亮)
  const doc = await markdownDocx(SAMPLE_MD, {
    codeHighlight: {
      enabled: true,
      theme: "github-light",
    },
  })
  console.log("[dump] markdownDocx 转换完成")

  // 2. 序列化 → base64
  const base64Original = await Packer.toBase64String(doc)
  console.log(`[dump] Packer.toBase64String 完成,长度 ${base64Original.length} 字符`)

  // 3. 拆 zip → 改 word/document.xml(fork 自家 post-process)
  const zipObj = unzipSync(base64ToBytes(base64Original))
  let docXml = strFromU8(zipObj["word/document.xml"]!)
  console.log(`[dump] 原 document.xml 长度 ${docXml.length} 字符`)

  docXml = mergeCodeBlockParagraphs(docXml)
  console.log("[dump] mergeCodeBlockParagraphs 完成(代码块段合并)")

  docXml = splitRunsForEmoji(docXml)
  console.log("[dump] splitRunsForEmoji 完成(emoji 字体覆盖)")

  zipObj["word/document.xml"] = strToU8(docXml)

  // 4. 重打包成 docx 字节
  const finalBytes = zipSync(zipObj)
  console.log(`[dump] zipSync 完成,最终大小 ${finalBytes.length} bytes`)

  // 5. 写盘
  const outPath = "D:/tmp/deskfox-test-output/sample-export.docx"
  writeFileSync(outPath, finalBytes)

  console.log("")
  console.log("✅ Sample docx 生成完成!")
  console.log(`完整路径(可复制到资源管理器):`)
  console.log(`  ${outPath}`)
  console.log("")
  console.log("用 Word 打开后请检查:")
  console.log("  - 标题层级 H1-H6 是否分明")
  console.log("  - 代码块是否有语法高亮 + 边框 + 灰底")
  console.log("  - 表格是否正确渲染")
  console.log("  - Emoji 😀🎉✓ 是否真彩色显示")
  console.log("  - 列表 / 引用 / 链接 是否格式正确")
}

main().catch((e) => {
  console.error("[dump] 失败:", e)
  process.exit(1)
})
