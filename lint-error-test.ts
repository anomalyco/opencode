// This file contains intentional linting errors

// Error: @typescript-eslint/no-explicit-any
const data: any = { name: "test" }

// Error: functional/no-let
let mutableVariable = 5

// Error: no-var
var oldStyleVar = "should not use"

// Error: prefer-const
let shouldNotChange = 10
shouldNotChange = 15

// Error: Class declarations are not allowed
class BadClass {
  constructor(public value: number) {}
}

// Error: @typescript-eslint/no-floating-promises
Promise.resolve("test")

// Error: @typescript-eslint/no-unnecessary-type-assertion
const str = "hello" as string

// Error: functional/no-try-statements
try {
  throw new Error("test")
} catch (error) {
  console.log(error)
}

// Error: max-params (more than 4 parameters)
function tooManyParams(a: number, b: number, c: number, d: number, e: number) {
  return a + b + c + d + e
}

// Error: complexity (too complex)
function complexFunction(x: number) {
  if (x > 0) {
    if (x > 10) {
      if (x > 20) {
        if (x > 30) {
          if (x > 40) {
            return x * 2
          }
        }
      }
    }
  }
  return x
}
