import { Context, Effect, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Config } from "@/config/config"
import path from "node:path"

export interface Interface {
  readonly getSpecificationTemplate: (type: string, inventionType: string) => Effect.Effect<string>
  readonly getClaimsTemplate: (type: string) => Effect.Effect<string>
  readonly getOATemplate: () => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentTemplate") {}

const templateContent = {
  specification: `# {{发明名称}}

## 技术领域
本发明涉及{{技术领域}}领域，特别涉及一种{{发明概述}}。

## 背景技术
{{背景技术描述}}

## 发明内容
本发明要解决的技术问题是：{{技术问题}}。

为解决上述技术问题，本发明采用的技术方案是：
{{技术方案概述}}

本发明的有益效果是：
{{有益效果}}

## 附图说明
{{附图说明}}

## 具体实施方式
下面结合附图和具体实施方式对本发明作进一步详细描述。

### 实施例1
{{实施例1描述}}

### 实施例2
{{实施例2描述}}`,

  claims: `## 权利要求书

1. 一种{{发明名称}}，其特征在于，包括：
{{必要技术特征}}

2. 根据权利要求1所述的{{发明名称}}，其特征在于，{{从属技术特征1}}。

3. 根据权利要求1所述的{{发明名称}}，其特征在于，{{从属技术特征2}}。

4. 根据权利要求1-3任一所述的{{发明名称}}，其特征在于，{{从属技术特征3}}。`,

  oa: `# 意见陈述书

## 申请信息
- 申请号：{{申请号}}
- 发明名称：{{发明名称}}
- 审查意见通知书日期：{{通知日期}}

## 答复概要
{{答复概要}}

## 驳回理由分析

### 驳回理由{{N}}：{{驳回类型}}（{{法律依据}}）

#### 审查员观点
{{审查员论点}}

#### 申请人意见
{{申请人答复}}

## 权利要求修改说明

### 修改依据
{{修改依据}}

### 修改内容
{{修改内容}}`,
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const config = yield* Config.Service
    const cfg = yield* config.get()
    const dataDir = cfg.patent?.dataDir ?? ""
    const templatesDir = path.join(dataDir, "templates")

    const getSpecificationTemplate = Effect.fn("PatentTemplate.getSpecificationTemplate")(
      function* (type: string, inventionType: string) {
        const templatePath = path.join(templatesDir, `specification-${type}-${inventionType}.txt`)
        const content = yield* fs
          .readFileString(templatePath)
          .pipe(Effect.catch(() => Effect.succeed(templateContent.specification)))
        return content
      },
    )

    const getClaimsTemplate = Effect.fn("PatentTemplate.getClaimsTemplate")(function* (type: string) {
      const templatePath = path.join(templatesDir, `claims-${type}.txt`)
      const content = yield* fs.readFileString(templatePath).pipe(Effect.catch(() => Effect.succeed(templateContent.claims)))
      return content
    })

    const getOATemplate = Effect.fn("PatentTemplate.getOATemplate")(function* () {
      const templatePath = path.join(templatesDir, "oa.txt")
      const content = yield* fs.readFileString(templatePath).pipe(Effect.catch(() => Effect.succeed(templateContent.oa)))
      return content
    })

    return Service.of({ getSpecificationTemplate, getClaimsTemplate, getOATemplate })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer)).pipe(Layer.provide(Config.defaultLayer))

export * as PatentTemplate from "./template"