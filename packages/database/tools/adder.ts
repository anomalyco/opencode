export const tool = {
  name: "adder",
  description: "Adds two nums",
  schema: { input: { a: 'number', b: 'number' }, output: { result: 'number' } },
}
export default function adder({ a, b }: { a: number; b: number }) {
  return { result: a + b }
}