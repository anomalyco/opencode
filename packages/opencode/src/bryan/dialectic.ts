/**
 * Bryan Dialectic Integration
 *
 * Implements the human-in-loop dialectic system for OpenCode.
 * Manages question/answer workflows between the AI system and Bryan.
 *
 * Features:
 * - Question file management (.bryan/ directory)
 * - Answer detection and processing
 * - Continuation signal generation
 * - Group-based routing (Philosophical Union, Groundwork Guild, Integration Assembly)
 *
 * Ported from: sisyphean-works/bootstrap/tools/dialectic.py
 */

import { Instance } from "../project/instance"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { BryanEvents } from "./events"
import path from "path"
import fs from "fs/promises"
import YAML from "yaml"

const log = Log.create({ service: "bryan-dialectic" })

export namespace Dialectic {
  /**
   * Dialectic question structure
   */
  export interface Question {
    id: string
    question: string
    context?: string
    group: Group
    priority: "low" | "medium" | "high" | "critical"
    ready: boolean
    answer?: string
    createdAt: string
    answeredAt?: string
  }

  /**
   * Groups that can receive questions
   */
  export type Group = "philosophical-union" | "groundwork-guild" | "integration-assembly"

  /**
   * Continuation signal for answered questions
   */
  export interface Continuation {
    id: string
    questionId: string
    group: Group
    prompt: string
    createdAt: string
    processedAt?: string
  }

  /**
   * Storage keys
   */
  const QUESTIONS_KEY = ["bryan", "questions"]
  const CONTINUATIONS_KEY = ["bryan", "continuations"]

  /**
   * Get the .bryan directory path
   */
  async function getBryanDir(): Promise<string> {
    const bryanPath = path.join(Instance.directory, ".bryan")
    await fs.mkdir(bryanPath, { recursive: true })
    return bryanPath
  }

  /**
   * Generate a unique question ID
   */
  function generateQuestionId(group: Group): string {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)
    const shortGroup = group.split("-")[0].slice(0, 4)
    return `${shortGroup}-${timestamp}`
  }

  /**
   * Create a new question for Bryan
   */
  export async function ask(options: {
    question: string
    context?: string
    group: Group
    priority?: "low" | "medium" | "high" | "critical"
  }): Promise<Question> {
    const bryanDir = await getBryanDir()
    const id = generateQuestionId(options.group)

    const question: Question = {
      id,
      question: options.question,
      context: options.context,
      group: options.group,
      priority: options.priority ?? "medium",
      ready: false,
      createdAt: new Date().toISOString(),
    }

    // Write YAML file for Bryan to answer
    const yamlContent = YAML.stringify({
      id: question.id,
      question: question.question,
      context: question.context,
      group: question.group,
      priority: question.priority,
      ready: false,
      answer: "",
      created_at: question.createdAt,
    })

    const filePath = path.join(bryanDir, `${id}.yaml`)
    await fs.writeFile(filePath, yamlContent)

    // Store in persistent storage
    try {
      await Storage.update<Record<string, Question>>(QUESTIONS_KEY, (draft) => {
        Object.assign(draft, { [id]: question })
      })
    } catch {
      // Storage doesn't exist yet, write initial state
      await Storage.write(QUESTIONS_KEY, { [id]: question })
    }

    log.info("Question created for Bryan", { id, group: options.group })

    Bus.publish(BryanEvents.QuestionCreated, {
      questionId: id,
      group: options.group,
      priority: question.priority,
    })

    return question
  }

  /**
   * Check for answered questions in .bryan/ directory
   */
  export async function checkAnswers(): Promise<Question[]> {
    const bryanDir = await getBryanDir()
    const answered: Question[] = []

    try {
      const files = await fs.readdir(bryanDir)
      const yamlFiles = files.filter((f) => f.endsWith(".yaml"))

      for (const file of yamlFiles) {
        try {
          const filePath = path.join(bryanDir, file)
          const content = await fs.readFile(filePath, "utf-8")
          const data = YAML.parse(content)

          if (data.ready === true && data.answer) {
            // Update storage
            let updatedQuestion: Question | undefined
            try {
              const result = await Storage.update<Record<string, Question>>(QUESTIONS_KEY, (draft) => {
                if (draft && draft[data.id]) {
                  draft[data.id].ready = true
                  draft[data.id].answer = data.answer
                  draft[data.id].answeredAt = new Date().toISOString()
                }
              })
              updatedQuestion = result?.[data.id]
            } catch {
              // No storage yet
            }

            if (updatedQuestion) {
              answered.push(updatedQuestion)
              // Create continuation signal
              await createContinuation(updatedQuestion)
            }
          }
        } catch (err) {
          log.warn("Failed to parse question file", { file, error: String(err) })
        }
      }
    } catch (err) {
      log.warn("Failed to read .bryan directory", { error: String(err) })
    }

    return answered
  }

  /**
   * Create a continuation signal for an answered question
   */
  async function createContinuation(question: Question): Promise<Continuation> {
    const id = `cont-${question.id}`

    const prompt = buildContinuationPrompt(question)

    const continuation: Continuation = {
      id,
      questionId: question.id,
      group: question.group,
      prompt,
      createdAt: new Date().toISOString(),
    }

    try {
      await Storage.update<Record<string, Continuation>>(CONTINUATIONS_KEY, (draft) => {
        Object.assign(draft, { [id]: continuation })
      })
    } catch {
      // Storage doesn't exist yet, write initial state
      await Storage.write(CONTINUATIONS_KEY, { [id]: continuation })
    }

    log.info("Continuation created", { id, questionId: question.id })

    Bus.publish(BryanEvents.ContinuationCreated, {
      continuationId: id,
      questionId: question.id,
      group: question.group,
    })

    return continuation
  }

  /**
   * Build the continuation prompt for a group
   */
  function buildContinuationPrompt(question: Question): string {
    const groupDescriptions: Record<Group, string> = {
      "philosophical-union": `You are continuing deliberation as the Philosophical Union.
Bryan has answered a question from your previous session.`,
      "groundwork-guild": `You are continuing work as the Groundwork Guild.
Bryan has provided guidance on a practical matter.`,
      "integration-assembly": `You are continuing coordination as the Integration Assembly.
Bryan has answered a question about system integration.`,
    }

    return `# Continuation: ${question.group}

${groupDescriptions[question.group]}

## Original Question
${question.question}

${question.context ? `## Context\n${question.context}\n` : ""}

## Bryan's Answer
${question.answer}

## Instructions
1. Process Bryan's answer in the context of your ongoing work
2. Update any relevant documentation or state
3. Continue with the next steps based on this guidance
4. If further clarification is needed, create a new question

Do NOT re-ask the same question. Bryan has spoken.`
  }

  /**
   * Get pending continuations that haven't been processed
   */
  export async function getPendingContinuations(): Promise<Continuation[]> {
    try {
      const continuations = (await Storage.read<Record<string, Continuation>>(CONTINUATIONS_KEY)) ?? {}
      return Object.values(continuations).filter((c) => !c.processedAt)
    } catch {
      return []
    }
  }

  /**
   * Mark a continuation as processed
   */
  export async function markProcessed(continuationId: string): Promise<void> {
    try {
      await Storage.update<Record<string, Continuation>>(CONTINUATIONS_KEY, (draft) => {
        if (draft && draft[continuationId]) {
          draft[continuationId].processedAt = new Date().toISOString()
        }
      })
      log.info("Continuation marked as processed", { continuationId })
    } catch (err) {
      log.warn("Failed to mark continuation as processed", { continuationId, error: String(err) })
    }
  }

  /**
   * Get all questions (for status display)
   */
  export async function getQuestions(): Promise<Record<string, Question>> {
    try {
      return (await Storage.read<Record<string, Question>>(QUESTIONS_KEY)) ?? {}
    } catch {
      return {}
    }
  }

  /**
   * Get status summary
   */
  export async function getStatus(): Promise<{
    pendingQuestions: number
    answeredQuestions: number
    pendingContinuations: number
    processedContinuations: number
  }> {
    const questions = await getQuestions()
    const continuations = (await Storage.read<Record<string, Continuation>>(CONTINUATIONS_KEY)) ?? {}

    const questionsList = Object.values(questions)
    const continuationsList = Object.values(continuations)

    return {
      pendingQuestions: questionsList.filter((q) => !q.ready).length,
      answeredQuestions: questionsList.filter((q) => q.ready).length,
      pendingContinuations: continuationsList.filter((c) => !c.processedAt).length,
      processedContinuations: continuationsList.filter((c) => c.processedAt).length,
    }
  }

  /**
   * Archive a processed question (move to archive)
   */
  export async function archiveQuestion(questionId: string): Promise<void> {
    const bryanDir = await getBryanDir()
    const archiveDir = path.join(bryanDir, "archive")
    await fs.mkdir(archiveDir, { recursive: true })

    const sourceFile = path.join(bryanDir, `${questionId}.yaml`)
    const destFile = path.join(archiveDir, `${questionId}.yaml`)

    try {
      await fs.rename(sourceFile, destFile)
      log.info("Question archived", { questionId })
    } catch (err) {
      log.warn("Failed to archive question", { questionId, error: String(err) })
    }
  }
}
