export * as QuestionOutput from "./question-output"

export const toModelOutput = (
  questions: ReadonlyArray<{ readonly question: string }>,
  answers: ReadonlyArray<ReadonlyArray<string>>,
) => {
  const formatted = questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}
