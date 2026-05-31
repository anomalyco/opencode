let count = 0
export const tool = {
  name: "counter",
  description: "Increment counter",
  schema: { input: {}, output: { count: 'number' } },
}
export default function counter() {
  count++
  return { count }
}