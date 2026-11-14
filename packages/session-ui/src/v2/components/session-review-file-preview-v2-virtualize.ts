import { virtualizeLineThreshold } from "../../pierre/virtualizer"

export function shouldVirtualizeReviewDiff(input: { additionLines: number; deletionLines: number }) {
  return Math.max(input.additionLines, input.deletionLines) > virtualizeLineThreshold
}
