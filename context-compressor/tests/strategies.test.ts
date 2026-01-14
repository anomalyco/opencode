/**
 * ============================================================================
 * Compression Strategies Tests
 * ============================================================================
 */

import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { truncate } from '../dist/strategies/truncate.js'
import { prune } from '../dist/strategies/prune.js'
import type { Message } from '../dist/core/types.js'

describe('Truncate Strategy', () => {
  it('should not truncate when under limit', async () => {
    const messages: Message[] = Array.from({ length: 5 }, (_, i) => ({
      id: `msg-${i}`,
      role: 'user' as const,
      timestamp: Date.now() + i,
      content: `Message ${i}`,
    }))

    const result = await truncate(messages, { enabled: true, maxMessages: 10 })
    assert.strictEqual(result.messages.length, 5)
    assert.strictEqual(result.tokensSaved, 0)
  })

  it('should truncate to max messages', async () => {
    const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
      id: `msg-${i}`,
      role: 'user' as const,
      timestamp: Date.now() + i,
      content: `Message ${i} content`,
    }))

    const result = await truncate(messages, { enabled: true, maxMessages: 5 })
    assert.strictEqual(result.messages.length, 5)
    assert.strictEqual(result.newCount, 5)
    assert.strictEqual(result.originalCount, 20)
    assert.strictEqual(result.messages[0]?.id, 'msg-15')
  })

  it('should return empty when disabled', async () => {
    const messages: Message[] = [
      { id: '1', role: 'user' as const, timestamp: Date.now(), content: 'Test' },
    ]

    const result = await truncate(messages, { enabled: false, maxMessages: 1 })
    assert.strictEqual(result.messages.length, 1)
  })
})

describe('Prune Strategy', () => {
  it('should not prune when disabled', async () => {
    const messages: Message[] = [
      {
        id: '1',
        role: 'assistant' as const,
        timestamp: Date.now(),
        parts: [
          {
            type: 'tool' as const,
            name: 'read',
            input: {},
            status: 'completed' as const,
            output: 'A'.repeat(10000),
            timestamp: Date.now(),
          },
        ],
      },
    ]

    const result = await prune(messages, { enabled: false, minimumSavings: 100, protectRecent: 1000, protectedTools: [] })
    assert.strictEqual(result.tokensSaved, 0)
    assert.strictEqual(result.toolsPruned, 0)
  })

  it('should prune old tool outputs', async () => {
    // Create many messages with tool outputs
    const messages: Message[] = []
    for (let i = 0; i < 10; i++) {
      messages.push(
        { id: `user-${i}`, role: 'user' as const, timestamp: Date.now() + i * 1000, content: `Message ${i}` },
        {
          id: `assistant-${i}`,
          role: 'assistant' as const,
          timestamp: Date.now() + i * 1000 + 500,
          parts: [
            {
              type: 'tool' as const,
              name: 'read',
              input: {},
              status: 'completed' as const,
              output: 'X'.repeat(5000), // Large output
              timestamp: Date.now() + i * 1000 + 500,
            },
          ],
        }
      )
    }

    const result = await prune(messages, {
      enabled: true,
      minimumSavings: 1000,
      protectRecent: 1000,
      protectedTools: [],
    })

    assert.strictEqual(result.messages.length, 20) // Messages still there
    assert.ok(result.tokensSaved > 0)
    assert.ok(result.toolsPruned > 0)
  })

  it('should protect recent turns', async () => {
    const messages: Message[] = [
      // Turn 1 (old - should be pruned)
      { id: '1', role: 'user' as const, timestamp: Date.now(), content: 'First' },
      {
        id: '2',
        role: 'assistant' as const,
        timestamp: Date.now() + 100,
        parts: [
          {
            type: 'tool' as const,
            name: 'read',
            input: {},
            status: 'completed' as const,
            output: 'X'.repeat(10000),
            timestamp: Date.now() + 100,
          },
        ],
      },
      // Turn 2 (old - should be pruned)
      { id: '3', role: 'user' as const, timestamp: Date.now() + 200, content: 'Second' },
      {
        id: '4',
        role: 'assistant' as const,
        timestamp: Date.now() + 300,
        parts: [
          {
            type: 'tool' as const,
            name: 'read',
            input: {},
            status: 'completed' as const,
            output: 'Y'.repeat(10000),
            timestamp: Date.now() + 300,
          },
        ],
      },
      // Turn 3 (old - should be pruned)
      { id: '5', role: 'user' as const, timestamp: Date.now() + 400, content: 'Third' },
      {
        id: '6',
        role: 'assistant' as const,
        timestamp: Date.now() + 500,
        parts: [
          {
            type: 'tool' as const,
            name: 'read',
            input: {},
            status: 'completed' as const,
            output: 'Z'.repeat(10000),
            timestamp: Date.now() + 500,
          },
        ],
      },
      // Turn 4 (recent - should be protected)
      { id: '7', role: 'user' as const, timestamp: Date.now() + 600, content: 'Fourth' },
      {
        id: '8',
        role: 'assistant' as const,
        timestamp: Date.now() + 700,
        parts: [
          {
            type: 'tool' as const,
            name: 'write',
            input: {},
            status: 'completed' as const,
            output: 'Done',
            timestamp: Date.now() + 700,
          },
        ],
      },
    ]

    const result = await prune(messages, {
      enabled: true,
      minimumSavings: 100,
      protectRecent: 1000,  // Lower threshold to ensure pruning happens
      protectedTools: [],
    })

    // Recent 2 turns (turns 3-4) should be protected
    // Turns 1-2's tools should be pruned
    assert.ok(result.toolsPruned > 0)
    assert.ok(result.tokensSaved > 0)
  })

  it('should respect protected tools', async () => {
    const messages: Message[] = [
      // Turn 1 (old - should be pruned)
      { id: '1', role: 'user' as const, timestamp: Date.now(), content: 'First' },
      {
        id: '2',
        role: 'assistant' as const,
        timestamp: Date.now(),
        parts: [
          {
            type: 'tool' as const,
            name: 'skill',
            input: {},
            status: 'completed' as const,
            output: 'X'.repeat(10000),
            timestamp: Date.now(),
          },
          {
            type: 'tool' as const,
            name: 'read',
            input: {},
            status: 'completed' as const,
            output: 'Y'.repeat(10000),
            timestamp: Date.now(),
          },
        ],
      },
      // Turn 2 (old - should be pruned)
      { id: '3', role: 'user' as const, timestamp: Date.now(), content: 'Second' },
      {
        id: '4',
        role: 'assistant' as const,
        timestamp: Date.now(),
        parts: [
          {
            type: 'tool' as const,
            name: 'write',
            input: {},
            status: 'completed' as const,
            output: 'Done',
            timestamp: Date.now(),
          },
        ],
      },
      // Turn 3 (old - should be pruned)
      { id: '5', role: 'user' as const, timestamp: Date.now(), content: 'Third' },
      {
        id: '6',
        role: 'assistant' as const,
        timestamp: Date.now(),
        parts: [
          {
            type: 'tool' as const,
            name: 'edit',
            input: {},
            status: 'completed' as const,
            output: 'OK',
            timestamp: Date.now(),
          },
        ],
      },
      // Turn 4 (recent - should be protected)
      { id: '7', role: 'user' as const, timestamp: Date.now(), content: 'Fourth' },
      {
        id: '8',
        role: 'assistant' as const,
        timestamp: Date.now(),
        parts: [
          {
            type: 'tool' as const,
            name: 'run',
            input: {},
            status: 'completed' as const,
            output: 'Finished',
            timestamp: Date.now(),
          },
        ],
      },
    ]

    const result = await prune(messages, {
      enabled: true,
      minimumSavings: 100,
      protectRecent: 1000,  // Lower threshold to ensure pruning happens
      protectedTools: ['skill'],
    })

    // skill should be preserved (protected), read should be pruned
    // Find turn 1's assistant (the one with skill and read tools)
    const firstAssistant = result.messages.find(
      (m): m is Extract<Message, { role: 'assistant' }> =>
        m.role === 'assistant' && m.parts.some((p) => p.type === 'tool' && p.name === 'skill')
    )
    assert.ok(firstAssistant)
    const skillPart = firstAssistant.parts.find((p) => p.name === 'skill')
    const readPart = firstAssistant.parts.find((p) => p.name === 'read')

    assert.strictEqual(skillPart?.type, 'tool')
    if (skillPart?.type === 'tool') {
      assert.ok(!skillPart.compacted)
    }

    assert.strictEqual(readPart?.type, 'tool')
    if (readPart?.type === 'tool') {
      assert.ok(readPart.compacted)
    }
  })

  it('should stop at summary messages', async () => {
    const messages: Message[] = [
      { id: '1', role: 'user' as const, timestamp: Date.now(), content: 'First' },
      {
        id: '2',
        role: 'assistant' as const,
        timestamp: Date.now(),
        summary: true,
        parts: [{ type: 'text' as const, content: 'Summary of previous conversation' }],
      },
      { id: '3', role: 'user' as const, timestamp: Date.now(), content: 'After summary' },
      {
        id: '4',
        role: 'assistant' as const,
        timestamp: Date.now(),
        parts: [
          {
            type: 'tool' as const,
            name: 'read',
            input: {},
            status: 'completed' as const,
            output: 'X'.repeat(10000),
            timestamp: Date.now(),
          },
        ],
      },
    ]

    const result = await prune(messages, {
      enabled: true,
      minimumSavings: 100,
      protectRecent: 0,
      protectedTools: [],
    })

    // Should not prune after summary
    assert.strictEqual(result.toolsPruned, 0)
  })
})
