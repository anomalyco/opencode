import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { HashingProvider, cosine, textHash } from '../../src/recall/provider'

describe('HashingProvider', () => {
  test('embed returns Float32Array via Effect', async () => {
    const result = await Effect.runPromise(HashingProvider.embed(['hello world']))
    expect(result).toHaveLength(1)
    expect(result[0]).toBeInstanceOf(Float32Array)
    expect(result[0].length).toBe(256)
  })

  test('embed handles multiple texts in batch', async () => {
    const result = await Effect.runPromise(
      HashingProvider.embed(['hello', 'world', 'foo bar']),
    )
    expect(result).toHaveLength(3)
    for (const vec of result) {
      expect(vec).toBeInstanceOf(Float32Array)
      expect(vec.length).toBe(256)
    }
  })

  test('embed is deterministic — same text → same vector', async () => {
    const [v1, v2] = await Effect.runPromise(
      HashingProvider.embed(['hello world', 'hello world']),
    )
    for (let i = 0; i < 256; i++) {
      expect(v1[i]).toBeCloseTo(v2[i])
    }
  })

  test('different texts produce different vectors', async () => {
    const [v1, v2] = await Effect.runPromise(
      HashingProvider.embed(['hello', 'goodbye']),
    )
    // Different vectors — at least one dimension differs
    let differs = false
    for (let i = 0; i < 256; i++) {
      if (Math.abs(v1[i] - v2[i]) > 0.001) {
        differs = true
        break
      }
    }
    expect(differs).toBe(true)
  })

  test('cosine same vector returns 1', async () => {
    const [v] = await Effect.runPromise(HashingProvider.embed(['hello']))
    expect(cosine(v, v)).toBeCloseTo(1)
  })

  test('cosine is bounded between 0 and 1', async () => {
    const [v1, v2] = await Effect.runPromise(
      HashingProvider.embed(['hello world', 'goodbye cruel world']),
    )
    const score = cosine(v1, v2)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test('textHash is deterministic', () => {
    const h1 = textHash('hello world')
    const h2 = textHash('hello world')
    expect(h1).toBe(h2)
  })

  test('textHash is different for different inputs', () => {
    const h1 = textHash('hello')
    const h2 = textHash('world')
    expect(h1).not.toBe(h2)
  })

  test('textHash returns 8-char hex string', () => {
    const h = textHash('test')
    expect(h).toMatch(/^[0-9a-f]{8}$/)
  })

  test('provider metadata is correct', () => {
    expect(HashingProvider.id).toBe('hashing')
    expect(HashingProvider.dim).toBe(256)
    expect(HashingProvider.modelID).toBe('char-trigram-v1')
  })
})
