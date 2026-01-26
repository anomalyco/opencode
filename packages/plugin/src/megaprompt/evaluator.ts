export type ModelResponse = {
  modelID: string
  providerID: string
  text: string
  success: boolean
  error?: string
}

export type EvaluationResult = {
  winner: {
    modelID: string
    providerID: string
    reason: string
  }
  feedback: string[]
  winningResponse: string
}

export function buildJudgePrompt(userPrompt: string, responses: ModelResponse[]): string {
  const successfulResponses = responses.filter((r) => r.success)

  if (successfulResponses.length === 0) {
    return "No responses available to evaluate."
  }

  if (successfulResponses.length === 1) {
    return `Only one model responded successfully. Declaring ${successfulResponses[0].providerID}/${successfulResponses[0].modelID} as the winner by default.

Response:
${successfulResponses[0].text}`
  }

  const responsesText = successfulResponses
    .map(
      (r, i) => `
### Response ${i + 1}: ${r.providerID}/${r.modelID}

${r.text}
`,
    )
    .join("\n---\n")

  return `Role: Improvement Specialist (Gemini 3)
Context: You are evaluating responses from ${successfulResponses.length} different AI models to the following prompt:

---
USER PROMPT:
${userPrompt}
---

MODEL RESPONSES:
${responsesText}

---

Output Requirements:
1. **Winner**: State clearly which model (by providerID/modelID) provided the best overall response and explain why in 2-3 sentences.
2. **Feedback**: Analyze the other ${successfulResponses.length - 1} answers. Identify every unique insight, better explanation, missed edge-case, or alternative approach they provided that was NOT in the winner's response. List these as specific, actionable improvements to make the winning answer even better.

Format your response as follows:

## Winner
**Model**: [providerID/modelID]
**Reason**: [Your explanation of why this response is best]

## Improvements from Other Responses
[List each unique insight, alternative approach, or missed detail from the non-winning responses as bullet points. Each bullet should be specific enough to be actionable.]

## Winning Response
[Include the full text of the winning response here]`
}

export function parseEvaluationResult(evaluatorResponse: string, responses: ModelResponse[]): EvaluationResult {
  const lines = evaluatorResponse.split("\n")
  let winner = { modelID: "", providerID: "", reason: "" }
  let feedback: string[] = []
  let winningResponse = ""
  let section = ""

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("## Winner")) {
      section = "winner"
      continue
    }
    if (trimmed.startsWith("## Improvements") || trimmed.startsWith("## Feedback")) {
      section = "feedback"
      continue
    }
    if (trimmed.startsWith("## Winning Response")) {
      section = "response"
      continue
    }

    if (section === "winner") {
      if (trimmed.startsWith("**Model**:")) {
        const modelStr = trimmed.replace("**Model**:", "").trim()
        const parts = modelStr.split("/")
        if (parts.length >= 2) {
          winner.providerID = parts[0]
          winner.modelID = parts.slice(1).join("/")
        }
      }
      if (trimmed.startsWith("**Reason**:")) {
        winner.reason = trimmed.replace("**Reason**:", "").trim()
      }
    }

    if (section === "feedback" && trimmed.startsWith("-")) {
      feedback.push(trimmed.substring(1).trim())
    }

    if (section === "response") {
      winningResponse += line + "\n"
    }
  }

  // Fallback: if parsing failed, try to find the winning response from original responses
  if (!winningResponse.trim() && winner.modelID) {
    const original = responses.find((r) => r.modelID === winner.modelID && r.providerID === winner.providerID)
    if (original) {
      winningResponse = original.text
    }
  }

  return {
    winner,
    feedback,
    winningResponse: winningResponse.trim(),
  }
}
