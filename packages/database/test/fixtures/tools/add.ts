export const tool = {
  name: "add",
  description: "Add two numbers",
  schema: {
    input: { a: "number", b: "number" },
    output: { result: "number" },
  },
}

export default function add({ a, b }: { a: number; b: number }) {
  return { result: a + b }
}
