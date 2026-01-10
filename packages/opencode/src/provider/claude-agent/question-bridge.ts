import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Question } from "@/question"
import { Log } from "@/util/log"

const log = Log.create({ service: "claude-agent.question-bridge" })

export namespace QuestionBridge {
  export function create(sessionID: string) {
    async function ask(questions: Question.Info[], signal: AbortSignal): Promise<Question.Answer[]> {
      log.debug("asking questions", {
        questionsCount: questions.length,
        sessionID,
      })

      const result = await Question.ask({
        sessionID,
        questions,
      })

      log.debug("questions resolved", {
        answersCount: result.length,
        questionsCount: questions.length,
      })

      return result
    }

    return {
      ask,
    }
  }
}