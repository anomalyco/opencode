export * as NaturalLanguageAutomation from "./nl-builder"
export * as NLAutomationBuilder from "./nl-builder"

import { Effect } from "effect"
import { AutomationClassifier, type Classification } from "./classifier"
import { SessionSchema } from "../session/schema"
import { Automation } from "./automation"
import type { Schedule } from "./sql"

export interface NotificationSpec {
  readonly channel: "session_log" | "webhook" | "alert"
  readonly condition: "on_failure" | "always" | "on_success"
  readonly target?: string
}

export interface AutomationPipelineSpec {
  readonly name: string
  readonly prompt: string
  readonly schedule: Schedule
  readonly classification: Classification
  readonly agent?: string
  readonly notification: NotificationSpec
  readonly enabled: boolean
}

export const parseNaturalLanguageSchedule = (text: string): { cron: string; cleanPrompt: string } => {
  const lower = text.toLowerCase()

  let cron = "0 * * * *" // default hourly
  let cleanPrompt = text

  // Every N minutes
  const everyNMin = lower.match(/\bevery\s+(\d+)\s*(?:mins?|minutes?)\b/)
  if (everyNMin && everyNMin[1]) {
    cron = `*/${everyNMin[1]} * * * *`
    cleanPrompt = cleanPrompt.replace(everyNMin[0], "").trim()
  } else if (/\bevery\s+minute\b/.test(lower)) {
    cron = "* * * * *"
    cleanPrompt = cleanPrompt.replace(/\bevery\s+minute\b/i, "").trim()
  }
  // Every N hours
  else if (lower.match(/\bevery\s+(\d+)\s*(?:hrs?|hours?)\b/)) {
    const match = lower.match(/\bevery\s+(\d+)\s*(?:hrs?|hours?)\b/)!
    cron = `0 */${match[1]} * * *`
    cleanPrompt = cleanPrompt.replace(match[0], "").trim()
  } else if (/\bevery\s+hour\b|\bhourly\b/.test(lower)) {
    cron = "0 * * * *"
    cleanPrompt = cleanPrompt.replace(/\bevery\s+hour\b|\bhourly\b/i, "").trim()
  }
  // Every weekday at HH(:MM)?(am|pm)?
  else if (/\bevery\s+weekday\b|\bweekdays\b/.test(lower)) {
    const timeMatch = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
    let hour = 9
    let min = 0
    if (timeMatch) {
      hour = parseInt(timeMatch[1]!, 10)
      if (timeMatch[3] === "pm" && hour < 12) hour += 12
      if (timeMatch[3] === "am" && hour === 12) hour = 0
      min = timeMatch[2] ? parseInt(timeMatch[2]!, 10) : 0
      cleanPrompt = cleanPrompt.replace(timeMatch[0], "").trim()
    }
    cron = `${min} ${hour} * * 1-5`
    cleanPrompt = cleanPrompt.replace(/\bevery\s+weekday\b|\bweekdays\b/i, "").trim()
  }
  // Daily / Midnight / Nightly
  else if (/\bevery\s+night\b|\bnightly\b|\bat\s+midnight\b/.test(lower)) {
    cron = "0 0 * * *"
    cleanPrompt = cleanPrompt.replace(/\bevery\s+night\b|\bnightly\b|\bat\s+midnight\b/i, "").trim()
  } else if (/\bevery\s+day\b|\bdaily\b/.test(lower)) {
    const timeMatch = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
    let hour = 9
    let min = 0
    if (timeMatch) {
      hour = parseInt(timeMatch[1]!, 10)
      if (timeMatch[3] === "pm" && hour < 12) hour += 12
      if (timeMatch[3] === "am" && hour === 12) hour = 0
      min = timeMatch[2] ? parseInt(timeMatch[2]!, 10) : 0
      cleanPrompt = cleanPrompt.replace(timeMatch[0], "").trim()
    }
    cron = `${min} ${hour} * * *`
    cleanPrompt = cleanPrompt.replace(/\bevery\s+day\b|\bdaily\b/i, "").trim()
  }

  // Clean leading conjunctions/punctuation
  cleanPrompt = cleanPrompt.replace(/^[,:\s-]+/, "").replace(/^then\s+/i, "").trim()

  return { cron, cleanPrompt: cleanPrompt || text }
}

export const parseNotificationSpec = (text: string): NotificationSpec => {
  const lower = text.toLowerCase()
  let channel: NotificationSpec["channel"] = "session_log"
  let condition: NotificationSpec["condition"] = "always"
  let target: string | undefined

  if (lower.includes("slack") || lower.includes("webhook")) {
    channel = "webhook"
    const urlMatch = text.match(/https?:\/\/[^\s]+/)
    if (urlMatch) target = urlMatch[0]
  } else if (lower.includes("alert") || lower.includes("notify")) {
    channel = "alert"
  }

  if (lower.includes("on failure") || lower.includes("if fails") || lower.includes("if tests fail") || lower.includes("on error")) {
    condition = "on_failure"
  } else if (lower.includes("on success") || lower.includes("if passes")) {
    condition = "on_success"
  }

  return {
    channel,
    condition,
    ...(target ? { target } : {}),
  }
}

export const buildPipelineSpec = Effect.fn("NaturalLanguageAutomation.buildPipelineSpec")(function* (
  inputPrompt: string,
) {
  const classifier = yield* AutomationClassifier.Service

  const { cron, cleanPrompt } = parseNaturalLanguageSchedule(inputPrompt)
  const notification = parseNotificationSpec(inputPrompt)
  const classification = yield* classifier.classify(cleanPrompt)

  const words = cleanPrompt.split(/\s+/).slice(0, 5).join(" ")
  const name = `Auto: ${words.slice(0, 30)}`

  const spec: AutomationPipelineSpec = {
    name,
    prompt: cleanPrompt,
    schedule: { type: "cron", expression: cron },
    classification,
    agent: classification.complexity === "high" ? "build" : undefined,
    notification,
    enabled: true,
  }

  return spec
})

export const registerFromNaturalLanguage = Effect.fn("NaturalLanguageAutomation.registerFromNaturalLanguage")(function* (
  sessionID: SessionSchema.ID,
  naturalPrompt: string,
) {
  const automation = yield* Automation.Service
  const spec = yield* buildPipelineSpec(naturalPrompt)

  const trigger = yield* automation.create({
    sessionID,
    name: spec.name,
    prompt: spec.prompt,
    schedule: spec.schedule,
    agent: spec.agent,
  })

  return { trigger, spec }
})
