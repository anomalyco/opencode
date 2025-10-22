// Test function with any type to trigger ESLint rule
function testFunction(data: any): any {
  return data
}

// Another example
const processData = (input: any): string => {
  return String(input)
}

// Variable with any type
const someVariable: any = { name: "test" }

export { testFunction, processData, someVariable }
