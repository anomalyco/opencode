/**
 * ============================================================================
 * Integration Tests
 * ============================================================================
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert'
import { ContextCompressor, MemoryStorage, isOverflow, type Message } from '../dist/index.js'

describe('ContextCompressor Integration', () => {
  let compressor: ContextCompressor
  let storage: MemoryStorage
  let messages: Message[]

  before(() => {
    // Setup
    storage = new MemoryStorage()
    compressor = new ContextCompressor(
      {
        maxTokens: 10000,
        outputReserve: 2000,
        truncate: { enabled: true, maxMessages: 10 },
        prune: { enabled: true, minimumSavings: 1000, protectRecent: 3000, protectedTools: [] },
        summarize: { enabled: false },
      },
      storage
    )

    // Create test messages
    messages = []
    for (let i = 0; i < 20; i++) {
      messages.push({
        id: `user-${i}`,
        role: 'user',
        timestamp: Date.now() + i * 1000,
        content: `User message ${i} with some content that takes up space`,
      })

      messages.push({
        id: `assistant-${i}`,
        role: 'assistant',
        timestamp: Date.now() + i * 1000 + 500,
        parts: [
          { type: 'text', content: `Assistant response ${i}` },
          {
            type: 'tool',
            name: 'read',
            input: {},
            status: 'completed',
            output: `Tool output ${i} with lots of repeated content: ${'x'.repeat(500)}`,
            timestamp: Date.now() + i * 1000 + 500,
          },
        ],
      })
    }
  })

  describe('Overflow Detection', () => {
    it('should detect overflow', () => {
      // Use a smaller maxTokens to ensure overflow
      const overflow = isOverflow(messages, { maxTokens: 1000, outputReserve: 200 })
      assert.strictEqual(overflow, true)
    })

    it('should not overflow with small dataset', () => {
      const smallMessages: Message[] = [
        { id: '1', role: 'user', timestamp: Date.now(), content: 'Hello' },
        {
          id: '2',
          role: 'assistant',
          timestamp: Date.now(),
          parts: [{ type: 'text', content: 'Hi!' }],
        },
      ]
      const overflow = isOverflow(smallMessages, { maxTokens: 10000, outputReserve: 2000 })
      assert.strictEqual(overflow, false)
    })
  })

  describe('Compress Messages', () => {
    it('should apply truncate strategy', async () => {
      // Use a smaller maxTokens to ensure overflow
      const smallCompressor = new ContextCompressor(
        {
          maxTokens: 1000,
          outputReserve: 200,
          truncate: { enabled: true, maxMessages: 10 },
          prune: { enabled: true, minimumSavings: 1000, protectRecent: 3000, protectedTools: [] },
          summarize: { enabled: false },
        },
        storage
      )
      const { messages: compressed, result } = await smallCompressor.compressMessages(messages)

      assert.strictEqual(result.strategy, 'truncate')
      assert.ok(compressed.length < messages.length)
      assert.strictEqual(compressed.length, 10) // maxMessages
      assert.ok(result.tokensSaved > 0)
    })

    it('should return no compression when not needed', async () => {
      const smallMessages: Message[] = [
        { id: '1', role: 'user', timestamp: Date.now(), content: 'Hello' },
        {
          id: '2',
          role: 'assistant',
          timestamp: Date.now(),
          parts: [{ type: 'text', content: 'Hi!' }],
        },
      ]

      const { messages: compressed, result } = await compressor.compressMessages(smallMessages)

      assert.strictEqual(result.strategy, 'none')
      assert.strictEqual(result.tokensSaved, 0)
      assert.strictEqual(compressed.length, 2)
    })
  })

  describe('Compress with Storage', () => {
    it('should compress and persist to storage', async () => {
      const sessionId = 'test-session'

      // Create a smaller compressor to ensure overflow
      const smallCompressor = new ContextCompressor(
        {
          maxTokens: 1000,
          outputReserve: 200,
          truncate: { enabled: true, maxMessages: 10 },
          prune: { enabled: true, minimumSavings: 1000, protectRecent: 3000, protectedTools: [] },
          summarize: { enabled: false },
        },
        storage
      )

      // Add messages to storage
      for (const msg of messages) {
        await storage.addMessage(sessionId, msg)
      }

      // Verify messages were added
      const before = await storage.getMessages(sessionId)
      assert.strictEqual(before.length, messages.length)

      // Compress
      const result = await smallCompressor.compress(sessionId)

      // Verify compression
      assert.ok(result.tokensSaved > 0)

      // Verify storage was updated
      const after = await storage.getMessages(sessionId)
      assert.ok(after.length < messages.length)
    })
  })

  describe('Statistics', () => {
    it('should provide accurate statistics', () => {
      // Use a smaller compressor to ensure overflow
      const smallCompressor = new ContextCompressor(
        {
          maxTokens: 1000,
          outputReserve: 200,
          truncate: { enabled: true, maxMessages: 10 },
          prune: { enabled: true, minimumSavings: 1000, protectRecent: 3000, protectedTools: [] },
          summarize: { enabled: false },
        },
        storage
      )
      const stats = smallCompressor.getStats(messages)

      assert.ok(stats.total > 0)
      assert.ok(stats.overflow > 0)
      assert.ok(stats.percentage > 0)
      // percentage can be > 100 when overflow exceeds usable tokens
      assert.ok(stats.percentage > 0)
    })

    it('should estimate savings by strategy', () => {
      const savings = compressor.estimateSavings(messages)

      assert.ok(savings.truncate >= 0)
      assert.ok(savings.prune >= 0)
      assert.ok(savings.summarize >= 0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty message array', async () => {
      const { messages: compressed, result } = await compressor.compressMessages([])

      assert.strictEqual(result.strategy, 'none')
      assert.strictEqual(compressed.length, 0)
      assert.strictEqual(result.tokensSaved, 0)
    })

    it('should handle single message', async () => {
      const single: Message[] = [{ id: '1', role: 'user', timestamp: Date.now(), content: 'Test' }]

      const { messages: compressed, result } = await compressor.compressMessages(single)

      assert.strictEqual(result.strategy, 'none')
      assert.strictEqual(compressed.length, 1)
    })

    it('should handle messages without parts', async () => {
      const messages: Message[] = [
        { id: '1', role: 'user', timestamp: Date.now(), content: 'First' },
        { id: '2', role: 'assistant', timestamp: Date.now(), parts: [] },
      ]

      const { messages: compressed } = await compressor.compressMessages(messages)

      assert.ok(compressed.length <= 2)
    })
  })
})
