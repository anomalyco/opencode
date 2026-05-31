export const tool = {
  name: "multiplier",
  description: "Multiplies two nums",
  schema: { input: { a: 'number', b: 'number' }, output: { result: 'number' } },
}
export default function mult({ a, b }: { a: number; b: number }) {
  return { result: a * b }
}