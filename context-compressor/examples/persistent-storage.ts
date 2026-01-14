/**
 * ============================================================================
 * Persistent Storage Example
 * ============================================================================
 *
 * Demonstrates using file-based persistent storage.
 */

import {
  ContextCompressor,
  FileStorage,
  MemoryStorage,
  createProvider,
  type Message,
} from '../src/index.js'

/**
 * Example: Session-based compression with persistent storage
 */
async function persistentExample() {
  console.log('=== Persistent Storage Example ===\n')

  // Create file-based storage
  const storage = new FileStorage('./context-data')

  // Simulate a session
  const sessionId = 'session-user-123'

  // Add initial messages
  console.log('1. Adding initial messages...')
  await storage.addMessage(sessionId, {
    id: 'msg-1',
    role: 'system',
    timestamp: Date.now(),
    content: 'You are a helpful assistant.',
  })

  await storage.addMessage(sessionId, {
    id: 'msg-2',
    role: 'user',
    timestamp: Date.now(),
    content: 'Hello!',
  })

  await storage.addMessage(sessionId, {
    id: 'msg-3',
    role: 'assistant',
    timestamp: Date.now(),
    parts: [
      {
        type: 'text',
        content: 'Hi! How can I help you today?',
      },
    ],
  })

  // Retrieve messages
  console.log('2. Retrieving messages...')
  const messages = await storage.getMessages(sessionId)
  console.log(`   Found ${messages.length} messages\n`)

  // Create compressor with persistent storage
  console.log('3. Creating compressor...')
  const compressor = new ContextCompressor(
    {
      maxTokens: 100000,
      outputReserve: 4000,
      truncate: { enabled: true, maxMessages: 10 },
      prune: { enabled: true, minimumSavings: 5000, protectRecent: 10000, protectedTools: [] },
      summarize: { enabled: false },
    },
    storage // File-based storage
  )
  console.log('   Compressor created with FileStorage\n')

  // Check session
  console.log('4. Checking session...')
  const hasSession = await storage.hasSession(sessionId)
  console.log(`   Session exists: ${hasSession}\n`)

  // List all sessions
  console.log('5. Listing all sessions...')
  const sessions = await storage.listSessions()
  console.log(`   Total sessions: ${sessions.length}`)
  console.log(`   Session IDs: ${sessions.join(', ')}\n`)

  // Compress the session
  console.log('6. Compressing session...')
  const result = await compressor.compress(sessionId)
  console.log(`   Strategy: ${result.strategy}`)
  console.log(`   Tokens saved: ${result.tokensSaved}\n`)

  // Verify persisted data
  console.log('7. Verifying persisted data...')
  const compressedMessages = await storage.getMessages(sessionId)
  console.log(`   Messages after compression: ${compressedMessages.length}\n`)

  console.log('✅ Persistent storage example complete!')
  console.log(`   Data saved to: ./context-data/${sessionId}.json`)
}

/**
 * Example: Multi-session management
 */
async function multiSessionExample() {
  console.log('\n=== Multi-Session Example ===\n')

  const storage = new FileStorage('./context-data')
  const sessions = ['session-1', 'session-2', 'session-3']

  // Create sessions
  console.log('1. Creating multiple sessions...')
  for (const sessionId of sessions) {
    await storage.addMessage(sessionId, {
      id: `${sessionId}-msg-1`,
      role: 'user',
      timestamp: Date.now(),
      content: `Session ${sessionId} - Message 1`,
    })
  }
  console.log(`   Created ${sessions.length} sessions\n`)

  // List sessions
  console.log('2. Listing all sessions...')
  const allSessions = await storage.listSessions()
  console.log(`   Total sessions: ${allSessions.length}`)
  for (const id of allSessions) {
    const msgs = await storage.getMessages(id)
    console.log(`   - ${id}: ${msgs.length} messages`)
  }
  console.log()

  // Clean up specific session
  console.log('3. Cleaning up session-2...')
  await storage.clear('session-2')

  const remainingSessions = await storage.listSessions()
  console.log(`   Remaining sessions: ${remainingSessions.length}\n`)

  console.log('✅ Multi-session example complete!')
}

/**
 * Example: Switching between memory and file storage
 */
async function storageSwitchExample() {
  console.log('\n=== Storage Switch Example ===\n')

  // Start with memory storage (fast, for active session)
  const memoryStorage = new MemoryStorage()

  await memoryStorage.addMessage('active', {
    id: 'msg-1',
    role: 'user',
    timestamp: Date.now(),
    content: 'Active session message',
  })

  console.log('1. Memory storage (for active session)')
  const memoryMessages = await memoryStorage.getMessages('active')
  console.log(`   Messages in memory: ${memoryMessages.length}\n`)

  // Switch to file storage (for persistence)
  const fileStorage = new FileStorage('./context-data')

  // Copy messages
  console.log('2. Copying to file storage...')
  for (const msg of memoryMessages) {
    await fileStorage.addMessage('active', msg)
  }

  const fileMessages = await fileStorage.getMessages('active')
  console.log(`   Messages in file: ${fileMessages.length}\n`)

  console.log('✅ Storage switch example complete!')
}

// Run examples
async function main() {
  await persistentExample()
  await multiSessionExample()
  await storageSwitchExample()
}

main().catch(console.error)
