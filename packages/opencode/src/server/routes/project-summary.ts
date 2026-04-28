import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { generateObject } from "ai"
import z from "zod"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Provider } from "../../provider/provider"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const ProjectSummaryShape = z.object({
  title: z.string(),
  description: z.string(),
  usage: z.string(),
})

const ProjectSummary = ProjectSummaryShape.meta({ ref: "ProjectSummary" })

export const ProjectSummaryRoutes = lazy(() =>
  new Hono().post(
    "/generate",
    describeRoute({
      summary: "Generate project summary",
      description:
        "Summarize the given session into a public-gallery project summary (title, description, usage). Runs in the background and is not appended to the session message stream.",
      operationId: "projectSummary.generate",
      responses: {
        200: {
          description: "Generated summary",
          content: {
            "application/json": {
              schema: resolver(ProjectSummary),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "json",
      z.object({
        sessionID: SessionID.zod,
        providerID: ProviderID.zod.optional(),
        modelID: ModelID.zod.optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      const msgs = await Session.messages({ sessionID: body.sessionID })

      let providerID = body.providerID
      let modelID = body.modelID
      if (!providerID || !modelID) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const info = msgs[i].info
          if (info.role === "user") {
            providerID = info.model.providerID
            modelID = info.model.modelID
            break
          }
        }
      }
      if (!providerID || !modelID) {
        const def = await Provider.defaultModel()
        providerID = def.providerID
        modelID = def.modelID
      }

      const info = await Provider.getModel(providerID, modelID)
      const language = await Provider.getLanguage(info)

      const transcript = msgs
        .map((m) => {
          const text = m.parts
            .filter((p): p is MessageV2.TextPart => p.type === "text")
            .map((p) => p.text)
            .join("\n")
          return text.trim().length > 0 ? `[${m.info.role}] ${text}` : ""
        })
        .filter((line) => line.length > 0)
        .join("\n\n")

      if (transcript.trim().length === 0) {
        return c.json({ title: "", description: "", usage: "" })
      }

      const { object } = await generateObject({
        model: language,
        abortSignal: c.req.raw.signal,
        schema: ProjectSummaryShape,
        system: [
          "당신은 공유 갤러리에 올라갈 '서비스 소개글' 을 작성합니다.",
          "독자는 코드를 읽지 않는 일반 사용자입니다. 결과물(앱/서비스) 자체를 소개하세요.",
          "절대 금지: 기술 스택, 라이브러리·프레임워크 이름, 구현 방식, 파일/함수/API 이름, 코드 용어, 디버깅 과정, '구현했습니다/추가했습니다' 같은 개발자 시점 표현.",
          "transcript 의 언어와 같은 언어로 답변하세요.",
        ].join(" "),
        prompt: `다음 작업 기록을 바탕으로, 이 결과물을 '서비스 소개' 형태로 정리하세요.

각 필드 가이드:
- title: 서비스의 이름 또는 한 줄 정체성. 60자 이내. 예) "증권 리서치 자동화 도구".
- description: 이 서비스가 사용자에게 무엇을 해주는지 한두 문장으로. 기술이 아니라 '가치/효용'. 예) "뉴스와 리서치 데이터를 자동으로 수집하여 종목별 분석 리포트를 만들어주는 도구입니다."
- usage: 사용자가 이 서비스를 쓰는 단계를 한 줄에 한 단계씩, 번호 없이 줄바꿈으로 구분. 각 단계는 명령형 문장. 예)
  "종목코드를 입력합니다
  기간을 선택합니다
  분석 시작 버튼을 클릭합니다"

작업 기록:
${transcript}`,
      })

      return c.json(object)
    },
  ),
)
