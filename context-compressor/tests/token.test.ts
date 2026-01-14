/**
 * ============================================================================
 * Token Estimation Tests
 * ============================================================================
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { estimate, countMessage, countMessages, getMessageStats } from '../dist/core/token.js'

describe('Token Estimation', () => {
  describe('estimate()', () => {
    it('should estimate empty string as 0', () => {
      assert.strictEqual(estimate(''), 0)
    })

    it('should estimate short text', () => {
      // Math.round(2/4) = 1
      assert.strictEqual(estimate('Hi'), 1)
      // Math.round(5/4) = 1
      assert.strictEqual(estimate('Hello'), 1)
      // Math.round(11/4) = 3
      assert.strictEqual(estimate('Hello world'), 3)
    })

    it('should estimate longer text', () => {
      const text = 'a'.repeat(1000)
      assert.strictEqual(estimate(text), 250)
    })

    it('should handle undefined/null', () => {
      assert.strictEqual(estimate(undefined as unknown as string), 0)
      assert.strictEqual(estimate(null as unknown as string), 0)
    })
  })

  describe('countMessage()', () => {
    it('should count user message tokens', () => {
      const msg = {
        id: '1',
        role: 'user' as const,
        timestamp: Date.now(),
        content: 'Hello world, how are you?',
      }
      assert.strictEqual(countMessage(msg), 6)
    })

    it('should count system message tokens', () => {
      const msg = {
        id: '1',
        role: 'system' as const,
        timestamp: Date.now(),
        content: 'You are a helpful assistant.',
      }
      assert.strictEqual(countMessage(msg), 7)
    })

    it('should count assistant message from parts', () => {
      const msg = {
        id: '1',
        role: 'assistant' as const,
        timestamp: Date.now(),
        parts: [
          { type: 'text' as const, content: 'Hello there!' },
          {
            type: 'tool' as const,
            name: 'read',
            input: {},
            status: 'completed' as const,
            output: 'File content here',
            timestamp: Date.now(),
          },
        ],
      }
      assert.strictEqual(countMessage(msg), 7)
    })

    it('should use token stats if available', () => {
      const msg = {
        id: '1',
        role: 'assistant' as const,
        timestamp: Date.now(),
        parts: [{ type: 'text' as const, content: 'Hello' }],
        tokens: { input: 100, output: 50 },
      }
      assert.strictEqual(countMessage(msg), 150)
    })
  })

  describe('countMessages()', () => {
    it('should count empty array', () => {
      assert.strictEqual(countMessages([]), 0)
    })

    it('should count multiple messages', () => {
      const messages = [
        { id: '1', role: 'user' as const, timestamp: Date.now(), content: 'Hello' },
        {
          id: '2',
          role: 'assistant' as const,
          timestamp: Date.now(),
          parts: [{ type: 'text' as const, content: 'Hi there!' }],
        },
      ]
      // "Hello" = 5/4 = 1, "Hi there!" = 9/4 = 2, total = 3
      assert.strictEqual(countMessages(messages), 3)
    })
  })

  describe('getMessageStats()', () => {
    it('should calculate statistics by role', () => {
      const messages = [
        { id: '1', role: 'system' as const, timestamp: Date.now(), content: 'System prompt' },
        { id: '2', role: 'user' as const, timestamp: Date.now(), content: 'User message' },
        { id: '3', role: 'user' as const, timestamp: Date.now(), content: 'Another user message' },
        {
          id: '4',
          role: 'assistant' as const,
          timestamp: Date.now(),
          parts: [{ type: 'text' as const, content: 'Assistant response' }],
        },
      ]

      const stats = getMessageStats(messages)
      // "System prompt" = 13/4 = 3.25 → 3
      // "User message" = 13/4 = 3.25 → 3
      // "Another user message" = 20/4 = 5
      // "Assistant response" = 18/4 = 4.5 → 5
      // Total = 16, system = 3, user = 8, assistant = 5
      assert.strictEqual(stats.total, 16)
      assert.strictEqual(stats.system, 3)
      assert.strictEqual(stats.user, 8)
      assert.strictEqual(stats.assistant, 5)
    })
  })
})
