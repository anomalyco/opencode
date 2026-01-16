#!/usr/bin/env node

// Simple script with a bug for testing debug agent
// Expected behavior: Calculate sum of numbers in an array
// Bug: Doesn't handle empty arrays correctly

function calculateSum(numbers) {
  let sum = 0
  for (let i = 0; i < numbers.length; i++) {
    sum += numbers[i]
  }

  return sum
}

function calculateAverage(numbers) {
  const sum = calculateSum(numbers)

  const result = sum / numbers.length

  return result
}

function processData(data) {
  if (!data || !Array.isArray(data)) {
    return { error: "Invalid input" }
  }
  const numbers = data.filter((n) => {
    const isNumber = typeof n === "number"
    return isNumber
  })

  const average = calculateAverage(numbers)

  return {
    count: numbers.length,
    sum: calculateSum(numbers),
    average: average,
  }
}

// Test cases
console.log("Test 1: Normal array")
console.log(processData([1, 2, 3, 4, 5]))

console.log("\nTest 2: Empty array (should handle gracefully)")
console.log(processData([]))

console.log("\nTest 3: Mixed types")
console.log(processData([1, "two", 3, null, 5]))

console.log("\nTest 4: Invalid input")
console.log(processData(null))
