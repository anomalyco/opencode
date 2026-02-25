import { describe, expect, test } from 'bun:test'
import {
  calculateTPS,
  DEFAULT_MIN_TPS_ELAPSED_MS,
  formatTPS,
  getMessageTPS,
  isValidForTPS,
  totalGeneratedTokens,
} from './tps'

describe('totalGeneratedTokens', () => {
  test('sums output and reasoning by default', () => {
    expect(totalGeneratedTokens({ output: 100, reasoning: 50 })).toBe(150)
  })

  test('excludes reasoning when configured', () => {
    expect(totalGeneratedTokens({ output: 100, reasoning: 50 }, false)).toBe(100)
  })

  test('handles zero tokens', () => {
    expect(totalGeneratedTokens({ output: 0, reasoning: 0 })).toBe(0)
  })

  test('handles reasoning-only responses', () => {
    expect(totalGeneratedTokens({ output: 0, reasoning: 50 })).toBe(50)
  })
})

describe('isValidForTPS', () => {
  const validMessage = {
    finish: 'stop' as const,
    tokens: { output: 100, reasoning: 50 },
    time: { created: 1000, firstToken: 1100, completed: 2000 },
  }

  test('returns true for valid text response', () => {
    expect(isValidForTPS(validMessage)).toBe(true)
  })

  test('returns false for summary messages', () => {
    expect(isValidForTPS({ ...validMessage, summary: true })).toBe(false)
  })

  test('returns false for tool-call responses', () => {
    expect(isValidForTPS({ ...validMessage, finish: 'tool-calls' })).toBe(false)
  })

  test('returns false for error responses', () => {
    expect(isValidForTPS({ ...validMessage, finish: 'error' })).toBe(false)
  })

  test('returns false for unknown finish reasons', () => {
    expect(isValidForTPS({ ...validMessage, finish: 'unknown' })).toBe(false)
  })

  test('returns false for null finish', () => {
    expect(isValidForTPS({ ...validMessage, finish: null })).toBe(false)
  })

  test('returns false for undefined finish', () => {
    expect(isValidForTPS({ ...validMessage, finish: undefined })).toBe(false)
  })

  test('returns false for zero tokens', () => {
    expect(
      isValidForTPS({
        ...validMessage,
        tokens: { output: 0, reasoning: 0 },
      }),
    ).toBe(false)
  })

  test('returns false for missing firstToken', () => {
    expect(
      isValidForTPS({
        ...validMessage,
        time: { ...validMessage.time, firstToken: undefined },
      }),
    ).toBe(false)
  })

  test('returns false for missing completed', () => {
    expect(
      isValidForTPS({
        ...validMessage,
        time: { ...validMessage.time, completed: undefined },
      }),
    ).toBe(false)
  })

  test('returns false for elapsed time below threshold', () => {
    expect(
      isValidForTPS({
        ...validMessage,
        time: {
          ...validMessage.time,
          completed: validMessage.time.firstToken! + DEFAULT_MIN_TPS_ELAPSED_MS - 1,
        },
      }),
    ).toBe(false)
  })

  test('returns true for elapsed time at threshold', () => {
    expect(
      isValidForTPS({
        ...validMessage,
        time: {
          ...validMessage.time,
          completed: validMessage.time.firstToken! + DEFAULT_MIN_TPS_ELAPSED_MS,
        },
      }),
    ).toBe(true)
  })

  test('respects custom minElapsedMs', () => {
    expect(
      isValidForTPS({
        ...validMessage,
        time: {
          ...validMessage.time,
          completed: validMessage.time.firstToken! + 100,
        },
        minElapsedMs: 50,
      }),
    ).toBe(true)
  })
})

describe('calculateTPS', () => {
  test('calculates correct rate for 1 second', () => {
    const result = calculateTPS(100, 1000)!
    expect(result.rate).toBe(100)
    expect(result.totalTokens).toBe(100)
    expect(result.elapsedMs).toBe(1000)
    expect(result.isValid).toBe(true)
  })

  test('calculates correct rate for 500ms', () => {
    const result = calculateTPS(50, 500)!
    expect(result.rate).toBe(100)
  })

  test('rounds to nearest integer', () => {
    expect(calculateTPS(100, 333)!.rate).toBe(300)
    expect(calculateTPS(100, 667)!.rate).toBe(150)
  })

  test('returns undefined for zero tokens', () => {
    expect(calculateTPS(0, 1000)).toBeUndefined()
  })

  test('returns undefined for elapsed time below threshold', () => {
    expect(calculateTPS(100, 249)).toBeUndefined()
  })

  test('returns undefined for negative elapsed time', () => {
    expect(calculateTPS(100, -100)).toBeUndefined()
  })

  test('returns undefined for non-finite results', () => {
    expect(calculateTPS(100, 0, 0)).toBeUndefined()
  })

  test('handles very high rates', () => {
    // Use custom minElapsedMs to allow short durations
    const result = calculateTPS(1000, 100, 50)!
    expect(result.rate).toBe(10000)
  })

  test('handles Claude 3.5 typical rate (~45 tok/s)', () => {
    const result = calculateTPS(180, 4000)!
    expect(result.rate).toBe(45)
  })

  test('handles GPT-4 typical rate (~25 tok/s)', () => {
    const result = calculateTPS(100, 4000)!
    expect(result.rate).toBe(25)
  })

  test('handles local model typical rate (~120 tok/s)', () => {
    const result = calculateTPS(600, 5000)!
    expect(result.rate).toBe(120)
  })
})

describe('formatTPS', () => {
  test('formats with locale string', () => {
    expect(formatTPS({ rate: 1234, totalTokens: 100, elapsedMs: 1000, isValid: true })).toBe(
      '1,234 tok/s',
    )
  })

  test('formats single digit', () => {
    expect(formatTPS({ rate: 5, totalTokens: 10, elapsedMs: 2000, isValid: true })).toBe('5 tok/s')
  })

  test('formats large numbers', () => {
    expect(formatTPS({ rate: 1234567, totalTokens: 1000, elapsedMs: 1000, isValid: true })).toBe(
      '1,234,567 tok/s',
    )
  })
})

describe('getMessageTPS', () => {
  test('returns full result for valid message', () => {
    const message = {
      finish: 'stop' as const,
      tokens: { output: 150, reasoning: 50 },
      time: { created: 1000, firstToken: 1000, completed: 3000 },
    }

    const result = getMessageTPS(message)
    expect(result).toBeDefined()
    expect(result!.rate).toBe(100)
    expect(result!.totalTokens).toBe(200)
    expect(result!.elapsedMs).toBe(2000)
  })

  test('returns undefined for invalid message', () => {
    const message = {
      finish: 'tool-calls' as const,
      tokens: { output: 0, reasoning: 0 },
      time: { created: 1000, firstToken: 1100, completed: 1200 },
    }

    expect(getMessageTPS(message)).toBeUndefined()
  })

  test('calculates output-only TPS', () => {
    const message = {
      finish: 'stop' as const,
      tokens: { output: 100, reasoning: 0 },
      time: { created: 1000, firstToken: 1000, completed: 3000 },
    }

    const result = getMessageTPS(message)
    expect(result).toBeDefined()
    expect(result!.rate).toBe(50)
    expect(result!.totalTokens).toBe(100)
  })
})
