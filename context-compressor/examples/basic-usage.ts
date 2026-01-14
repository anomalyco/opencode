/**
 * ============================================================================
 * Basic Usage Example
 * ============================================================================
 *
 * Demonstrates basic usage of the context compressor.
 */

import {
  ContextCompressor,
  MemoryStorage,
  createProvider,
  DefaultConfig,
  estimate,
  isOverflow,
  type Message,
  type UserMessage,
  type AssistantMessage,
} from '../src/index.js'

// Sample messages - simulating a long coding session
function generateSampleMessages(): Message[] {
  const messages: Message[] = []

  // System prompt
  messages.push({
    id: 'msg-1',
    role: 'system',
    timestamp: Date.now() - 1000000,
    content: 'You are a helpful coding assistant.',
  })

  // User: Create a function
  messages.push({
    id: 'msg-2',
    role: 'user',
    timestamp: Date.now() - 900000,
    content: 'Create a function to calculate fibonacci numbers',
  })

  // Assistant: Explains and writes code
  messages.push({
    id: 'msg-3',
    role: 'assistant',
    timestamp: Date.now() - 800000,
    parts: [
      {
        type: 'text',
        content: "I'll create a fibonacci function for you.",
      },
      {
        type: 'tool',
        name: 'write_file',
        input: { path: 'fib.ts', content: 'function fib(n: number) { ... }' },
        status: 'completed',
        output:
          'Successfully wrote to fib.ts:\nfunction fib(n: number): number {\n  if (n <= 1) return n\n  return fib(n - 1) + fib(n - 2)\n}',
        timestamp: Date.now() - 800000,
      },
    ],
  })

  // Add many more messages to simulate a long conversation...
  for (let i = 0; i < 50; i++) {
    messages.push({
      id: `msg-user-${i}`,
      role: 'user',
      timestamp: Date.now() - 700000 + i * 10000,
      content: `Iteration ${i}: Help me with this code`,
    })

    messages.push({
      id: `msg-assistant-${i}`,
      role: 'assistant',
      timestamp: Date.now() - 690000 + i * 10000,
      parts: [
        {
          type: 'text',
          content: `Here's what I suggest for iteration ${i}`,
        },
        {
          type: 'tool',
          name: 'read_file',
          input: { path: `file${i}.ts` },
          status: 'completed',
          output: `Content of file${i}.ts:\n${'// Very long file content\n'.repeat(100)}`,
          timestamp: Date.now() - 690000 + i * 10000,
        },
      ],
    })
  }

  return messages
}

async function main() {
  console.log('=== Context Compressor - Basic Usage ===\n')

  // 1. Generate sample messages
  console.log('1. Generating sample messages...')
  const messages = generateSampleMessages()

  // 2. Estimate tokens
  console.log('2. Estimating tokens...')
  const totalTokens = messages.reduce((sum, msg) => {
    if (msg.role === 'user' || msg.role === 'system') {
      return sum + estimate(msg.content)
    }
    return sum + estimate(JSON.stringify(msg.parts))
  }, 0)
  console.log(`   Total messages: ${messages.length}`)
  console.log(`   Estimated tokens: ${totalTokens}\n`)

  // 3. Check if overflow
  console.log('3. Checking for overflow...')
  const config = {
    maxTokens: 50000,
    outputReserve: 4000,
    truncate: { enabled: true, maxMessages: 20 },
    prune: {
      enabled: true,
      minimumSavings: 10000,
      protectRecent: 20000,
      protectedTools: [],
    },
    summarize: { enabled: false }, // Disabled for this demo
  }
  const overflow = isOverflow(messages, config)
  console.log(`   Overflow: ${overflow ? 'YES' : 'NO'}\n`)

  // 4. Create compressor
  console.log('4. Creating compressor...')
  const storage = new MemoryStorage()
  const compressor = new ContextCompressor(config, storage)
  console.log(`   Config: maxTokens=${config.maxTokens}, strategies enabled\n`)

  // 5. Compress messages
  console.log('5. Compressing messages...')
  const { messages: compressed, result } = await compressor.compressMessages(messages)

  // 6. Show results
  console.log('\n=== Compression Results ===')
  console.log(`Strategy: ${result.strategy}`)
  console.log(`Messages removed: ${result.messagesRemoved}`)
  console.log(`Tokens saved: ${result.tokensSaved}`)
  console.log(`Original messages: ${messages.length}`)
  console.log(`Compressed messages: ${compressed.length}`)

  // 7. Show statistics
  console.log('\n=== Statistics ===')
  const stats = compressor.getStats(messages)
  console.log(`Total tokens: ${stats.total}`)
  console.log(`Overflow amount: ${stats.overflow}`)
  console.log(`Usage percentage: ${stats.percentage}%`)

  // 8. Estimate potential savings
  console.log('\n=== Potential Savings by Strategy ===')
  const savings = compressor.estimateSavings(messages)
  console.log(`Truncate: ${savings.truncate} tokens`)
  console.log(`Prune: ${savings.prune} tokens`)
  console.log(`Summarize: ${savings.summarize} tokens`)

  console.log('\n✅ Demo complete!')
}

// Run the example
main().catch(console.error)
