// Test file to trigger ESLint violations from eslint.config.mjs

// Violation: Class declaration
class TestClass {
  public value: number = 0
  constructor() {
    this.value = 0
  }
}

// Violation: Using 'let' instead of 'const'
let mutableVar = "test"

// Violation: Using 'any' type
const anyValue: any = {}

// Violation: Using var
var oldStyleVar = "should not use"

// Violation: Using require instead of import
const fs = require("fs")

// Violation: Module exports syntax
module.exports = { TestClass }

// Violation: Function with too many parameters (max is 4)
function tooManyParams(a: string, b: number, c: boolean, d: object, e: Function) {
  return a + b + c + d + e
}

// Violation: Function with high complexity
function complexFunction(x: number) {
  if (x > 0) {
    if (x > 10) {
      if (x > 20) {
        if (x > 30) {
          if (x > 40) {
            return x * 2
          } else {
            return x * 1.5
          }
        } else {
          return x * 1.2
        }
      } else {
        return x * 1.1
      }
    } else {
      return x * 1.05
    }
  } else {
    return x
  }
}

// Violation: Using try-catch (functional/no-try-statements)
try {
  JSON.parse('{"invalid": json}')
} catch (error) {
  console.log(error)
}

// Violation: Using for loop (functional/no-loop-statements)
for (let i = 0; i < 10; i++) {
  console.log(i)
}

// Violation: Floating promises
Promise.resolve("test")

// Violation: Default export
export default TestClass
