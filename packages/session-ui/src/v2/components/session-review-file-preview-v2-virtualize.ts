const lineThreshold = 500

export function shouldVirtualizeReviewDiff(input: { additionLines: number; deletionLines: number }) {
  return Math.max(input.additionLines, input.deletionLines) > lineThreshold
}
