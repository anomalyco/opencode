import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { PatentKG } from "@/patent/kg"
import { testEffect } from "../lib/effect"

const mockNode: PatentKG.KGNode = {
  id: "1",
  node_type: "Concept",
  name: "三步法",
  title: "专利创造性判断的三步法",
  content: "1. 确定最接近的现有技术；2. 确定发明的区别特征和实际解决的技术问题；3. 判断要求保护的发明对本领域技术人员来说是否显而易见",
  law_refs_count: 3,
  source: "审查指南",
  full_ref: null,
  chapter: "第二部分第四章",
  article_number: "3.2.1",
  version: "2023",
}

const mockEdges: PatentKG.KGEdge[] = [
  { id: 1, source: "1", target: "2", relation: "related_to" },
  { id: 2, source: "1", target: "3", relation: "refers_to" },
]

const mockSearchResults: PatentKG.KGNode[] = [
  mockNode,
  {
    ...mockNode,
    id: "2",
    name: "创造性",
    title: "专利的创造性",
    content: "指同申请日以前已有的技术相比，该发明有突出的实质性特点和显著的进步",
  },
]

const mockByLawRef: PatentKG.KGNode[] = [
  {
    id: "4",
    node_type: "GuidelineRule",
    name: "规则4",
    title: "专利法第二十二条",
    content: "授予专利权的发明和实用新型，应当具备新颖性、创造性和实用性",
    law_refs_count: 1,
    source: "专利法",
    full_ref: "专利法第二十二条",
    chapter: null,
    article_number: "22",
    version: "2020",
  },
]

const mockLayer = Layer.succeed(
  PatentKG.Service,
  PatentKG.Service.of({
    queryNode: Effect.fn("mock.queryNode")((name: string) =>
      Effect.succeed(name === "三步法" ? mockNode : null),
    ),
    queryRelated: Effect.fn("mock.queryRelated")((nodeId: string) =>
      Effect.succeed(nodeId === "1" ? mockEdges : []),
    ),
    queryByLawRef: Effect.fn("mock.queryByLawRef")((ref: string) =>
      Effect.succeed(ref === "专利法第二十二条" ? mockByLawRef : []),
    ),
    fullTextSearch: Effect.fn("mock.fullTextSearch")((query: string) =>
      Effect.succeed(query.includes("创造性") ? mockSearchResults : []),
    ),
  }),
)

const it = testEffect(mockLayer)

describe("PatentKG", () => {
  it.effect("queryNode returns node when found", () =>
    Effect.gen(function* () {
      const service = yield* PatentKG.Service
      const result = yield* service.queryNode("三步法")
      expect(result).not.toBeNull()
      expect(result?.name).toBe("三步法")
      expect(result?.node_type).toBe("Concept")
    }),
  )

  it.effect("queryNode returns null when not found", () =>
    Effect.gen(function* () {
      const service = yield* PatentKG.Service
      const result = yield* service.queryNode("不存在概念")
      expect(result).toBeNull()
    }),
  )

  it.effect("queryRelated returns edges for valid node", () =>
    Effect.gen(function* () {
      const service = yield* PatentKG.Service
      const result = yield* service.queryRelated("1")
      expect(result).toHaveLength(2)
      expect(result[0].relation).toBe("related_to")
      expect(result[1].relation).toBe("refers_to")
    }),
  )

  it.effect("queryRelated returns empty array for invalid node", () =>
    Effect.gen(function* () {
      const service = yield* PatentKG.Service
      const result = yield* service.queryRelated("999")
      expect(result).toHaveLength(0)
    }),
  )

  it.effect("queryByLawRef returns nodes for matching ref", () =>
    Effect.gen(function* () {
      const service = yield* PatentKG.Service
      const result = yield* service.queryByLawRef("专利法第二十二条")
      expect(result).toHaveLength(1)
      expect(result[0].full_ref).toBe("专利法第二十二条")
    }),
  )

  it.effect("queryByLawRef returns empty array for non-matching ref", () =>
    Effect.gen(function* () {
      const service = yield* PatentKG.Service
      const result = yield* service.queryByLawRef("不存在的法律条文")
      expect(result).toHaveLength(0)
    }),
  )

  it.effect("fullTextSearch returns results for matching query", () =>
    Effect.gen(function* () {
      const service = yield* PatentKG.Service
      const result = yield* service.fullTextSearch("创造性")
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].name).toBe("三步法")
    }),
  )

  it.effect("fullTextSearch returns empty array for non-matching query", () =>
    Effect.gen(function* () {
      const service = yield* PatentKG.Service
      const result = yield* service.fullTextSearch("不存在xyz")
      expect(result).toHaveLength(0)
    }),
  )
})