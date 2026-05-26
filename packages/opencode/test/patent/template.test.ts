import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import * as PatentTemplate from "@/patent/template"

const mockLayer = Layer.succeed(
  PatentTemplate.Service,
  PatentTemplate.Service.of({
    getSpecificationTemplate: Effect.fn("mock.getSpecificationTemplate")(
      (_type: string, _inventionType: string) =>
        Effect.succeed(`# {{发明名称}}

## 技术领域
本发明涉及{{技术领域}}领域，特别涉及一种{{发明概述}}。

## 背景技术
{{背景技术描述}}`),
    ),
    getClaimsTemplate: Effect.fn("mock.getClaimsTemplate")((_type: string) =>
      Effect.succeed(`## 权利要求书

1. 一种{{发明名称}}，其特征在于，包括：
{{必要技术特征}}`),
    ),
    getOATemplate: Effect.fn("mock.getOATemplate")(() =>
      Effect.succeed(`# 意见陈述书

## 申请信息
- 申请号：{{申请号}}`),
    ),
  }),
)

const it = testEffect(mockLayer)

describe("PatentTemplate", () => {
  it.effect("getSpecificationTemplate returns template with placeholders", () =>
    Effect.gen(function* () {
      const svc = yield* PatentTemplate.Service
      const result = yield* svc.getSpecificationTemplate("invention", "device")
      expect(result).toContain("{{")
      expect(result).toContain("发明名称")
    }),
  )

  it.effect("getClaimsTemplate returns claims template", () =>
    Effect.gen(function* () {
      const svc = yield* PatentTemplate.Service
      const result = yield* svc.getClaimsTemplate("device")
      expect(result).toContain("权利要求")
      expect(result).toContain("{{")
    }),
  )

  it.effect("getOATemplate returns OA template", () =>
    Effect.gen(function* () {
      const svc = yield* PatentTemplate.Service
      const result = yield* svc.getOATemplate()
      expect(result).toContain("意见陈述书")
    }),
  )
})