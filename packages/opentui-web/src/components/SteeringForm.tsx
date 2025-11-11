import type { Component } from "solid-js"
import { createSignal, Show, For } from "solid-js"
import { GridPanel } from "../grid-components/GridPanel"
import { GridText } from "../grid-components/GridText"
import { GridTextWrap, calculateWrappedRows } from "../grid-components/GridTextWrap"

export interface SteeringQuestion {
  id: string
  label: string
  type: "single-choice" | "multi-choice" | "text"
  options?: string[]
  placeholder?: string
  required?: boolean
}

export interface SteeringQuestionConfig {
  title: string
  description?: string
  questions: SteeringQuestion[]
  submitLabel?: string
}

export interface SteeringAnswer {
  questionId: string
  answer: string | string[]
}

interface SteeringFormProps {
  config: SteeringQuestionConfig
  onSubmit: (answers: SteeringAnswer[]) => void
  row: number
  maxWidth: number
}

export const SteeringForm: Component<SteeringFormProps> = (props) => {
  const [answers, setAnswers] = createSignal<Record<string, string | string[]>>({})
  const [submitted, setSubmitted] = createSignal(false)
  const [hoveredOption, setHoveredOption] = createSignal<string | null>(null)
  const [hoveredSubmit, setHoveredSubmit] = createSignal(false)

  const allRequiredAnswered = () => {
    const required = props.config.questions.filter((q) => q.required !== false)
    return required.every((q) => {
      const answer = answers()[q.id]
      if (!answer) return false
      if (typeof answer === "string") return answer.trim().length > 0
      if (Array.isArray(answer)) return answer.length > 0
      return false
    })
  }

  const handleSingleChoice = (questionId: string, option: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: prev[questionId] === option ? "" : option,
    }))
  }

  const handleMultiChoice = (questionId: string, option: string) => {
    setAnswers((prev) => {
      const current = (prev[questionId] as string[]) || []
      const updated = current.includes(option) ? current.filter((o) => o !== option) : [...current, option]
      return { ...prev, [questionId]: updated }
    })
  }

  const handleTextChange = (questionId: string, value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: value,
    }))
  }

  const handleSubmit = () => {
    if (!allRequiredAnswered()) return
    setSubmitted(true)
    const formattedAnswers: SteeringAnswer[] = props.config.questions
      .map((q) => ({
        questionId: q.id,
        answer: answers()[q.id] || (q.type === "multi-choice" ? [] : ""),
      }))
      .filter((a) => {
        if (typeof a.answer === "string") return a.answer.length > 0
        if (Array.isArray(a.answer)) return a.answer.length > 0
        return false
      })

    props.onSubmit(formattedAnswers)
  }

  // Calculate row positions
  let currentRow = props.row
  const elements: any[] = []
  const bgWidth = `calc(100% - ${2 * 9.6}px)` // 2 char gap on right

  // Blank line above
  elements.push(
    <div
      style={{
        position: "absolute",
        left: "0",
        top: `${currentRow * 1.2}em`,
        width: bgWidth,
        height: "1.2em",
        background: "#1a1a1a",
      }}
    />,
  )
  currentRow++

  // Title
  elements.push(
    <div
      style={{
        position: "absolute",
        left: "0",
        top: `${currentRow * 1.2}em`,
        width: bgWidth,
        height: "1.2em",
        background: "#1a1a1a",
      }}
    />,
  )
  elements.push(<GridText col={4} row={currentRow} text={props.config.title} fg="#d19a66" bold />)
  currentRow++

  // Description
  if (props.config.description) {
    elements.push(
      <div
        style={{
          position: "absolute",
          left: "0",
          top: `${currentRow * 1.2}em`,
          width: bgWidth,
          height: "1.2em",
          background: "#1a1a1a",
        }}
      />,
    )
    elements.push(<GridText col={4} row={currentRow} text={props.config.description} fg="#6a6a6a" />)
    currentRow++
  }

  // Blank line
  elements.push(
    <div
      style={{
        position: "absolute",
        left: "0",
        top: `${currentRow * 1.2}em`,
        width: bgWidth,
        height: "1.2em",
        background: "#1a1a1a",
      }}
    />,
  )
  currentRow++

  if (!submitted()) {
    // Questions
    props.config.questions.forEach((question) => {
      // Question label
      elements.push(
        <div
          style={{
            position: "absolute",
            left: "0",
            top: `${currentRow * 1.2}em`,
            width: bgWidth,
            height: "1.2em",
            background: "#1a1a1a",
          }}
        />,
      )
      const labelText = question.required !== false ? `${question.label} *` : question.label
      elements.push(<GridText col={4} row={currentRow} text={labelText} fg="#ffffff" />)
      currentRow++

      // Options for single/multi choice
      if ((question.type === "single-choice" || question.type === "multi-choice") && question.options) {
        question.options.forEach((option) => {
          elements.push(
            <div
              style={{
                position: "absolute",
                left: "0",
                top: `${currentRow * 1.2}em`,
                width: bgWidth,
                height: "1.2em",
                background: "#1a1a1a",
              }}
            />,
          )

          const isSelected =
            question.type === "single-choice"
              ? answers()[question.id] === option
              : Array.isArray(answers()[question.id]) && (answers()[question.id] as string[]).includes(option)

          const icon = question.type === "single-choice" ? (isSelected ? "◉" : "○") : isSelected ? "☑" : "☐"
          const color = isSelected ? "#d19a66" : "#6a6a6a"
          const optionKey = `${question.id}-${option}`

          elements.push(
            <GridText
              col={6}
              row={currentRow}
              text={`${icon} ${option}`}
              fg={hoveredOption() === optionKey ? "#ffffff" : color}
              onClick={() => {
                if (question.type === "single-choice") {
                  handleSingleChoice(question.id, option)
                } else {
                  handleMultiChoice(question.id, option)
                }
              }}
              onMouseOver={() => setHoveredOption(optionKey)}
              onMouseOut={() => setHoveredOption(null)}
            />,
          )
          currentRow++
        })
      }

      // Text input (simplified - shows entered text)
      if (question.type === "text") {
        elements.push(
          <div
            style={{
              position: "absolute",
              left: "0",
              top: `${currentRow * 1.2}em`,
              width: bgWidth,
              height: "1.2em",
              background: "#1a1a1a",
            }}
          />,
        )
        const textValue = answers()[question.id] as string
        const displayText = textValue ? `> ${textValue}` : question.placeholder || "Click to enter text..."
        elements.push(<GridText col={6} row={currentRow} text={displayText} fg="#6a6a6a" />)
        currentRow++
      }

      // Blank line between questions
      elements.push(
        <div
          style={{
            position: "absolute",
            left: "0",
            top: `${currentRow * 1.2}em`,
            width: bgWidth,
            height: "1.2em",
            background: "#1a1a1a",
          }}
        />,
      )
      currentRow++
    })

    // Submit button
    elements.push(
      <div
        style={{
          position: "absolute",
          left: "0",
          top: `${currentRow * 1.2}em`,
          width: bgWidth,
          height: "1.2em",
          background: "#1a1a1a",
        }}
      />,
    )
    const submitText = allRequiredAnswered()
      ? `▶ ${props.config.submitLabel || "Submit Answers"}`
      : `○ ${props.config.submitLabel || "Submit Answers"} (complete required fields)`
    const submitColor = allRequiredAnswered() ? (hoveredSubmit() ? "#98c379" : "#d19a66") : "#6a6a6a"
    elements.push(
      <GridText
        col={4}
        row={currentRow}
        text={submitText}
        fg={submitColor}
        bold={allRequiredAnswered()}
        onClick={handleSubmit}
        onMouseOver={() => setHoveredSubmit(true)}
        onMouseOut={() => setHoveredSubmit(false)}
      />,
    )
    currentRow++
  } else {
    // Submitted state
    elements.push(
      <div
        style={{
          position: "absolute",
          left: "0",
          top: `${currentRow * 1.2}em`,
          width: bgWidth,
          height: "1.2em",
          background: "#1a1a1a",
        }}
      />,
    )
    elements.push(<GridText col={4} row={currentRow} text="✓ Answers Submitted" fg="#98c379" bold />)
    currentRow++

    // Show submitted answers
    props.config.questions.forEach((question) => {
      const answer = answers()[question.id]
      if (!answer) return

      elements.push(
        <div
          style={{
            position: "absolute",
            left: "0",
            top: `${currentRow * 1.2}em`,
            width: bgWidth,
            height: "1.2em",
            background: "#1a1a1a",
          }}
        />,
      )
      elements.push(<GridText col={4} row={currentRow} text={`${question.label}:`} fg="#6a6a6a" />)
      const answerText = Array.isArray(answer) ? answer.join(", ") : answer
      elements.push(<GridText col={4 + question.label.length + 2} row={currentRow} text={answerText} fg="#ffffff" />)
      currentRow++
    })
  }

  // Blank line below
  elements.push(
    <div
      style={{
        position: "absolute",
        left: "0",
        top: `${currentRow * 1.2}em`,
        width: bgWidth,
        height: "1.2em",
        background: "#1a1a1a",
      }}
    />,
  )
  currentRow++

  // Orange bar spanning all rows
  const formStartRow = props.row
  for (let row = formStartRow; row < currentRow; row++) {
    elements.push(<GridText col={0} row={row} text="▌" fg={submitted() ? "#98c379" : "#d19a66"} />)
  }

  return <>{elements}</>
}
