/**
 * Claude Code Skill System - Usage Examples
 *
 * Demonstrates how to use the skill system in various scenarios
 */

import { SkillSystem } from '../skill-system'

/**
 * Example 1: Basic usage with automatic skill activation
 */
async function basicUsage() {
  console.log('\n=== Example 1: Basic Usage ===\n')

  const system = new SkillSystem({
    debug: true,
    minConfidenceThreshold: 0.6,
  })

  // Initialize (discovers all skills)
  await system.initialize()

  // Process a user request - skills auto-activate
  const result = await system.processRequest(
    'Create a React component with hooks and TypeScript'
  )

  console.log('\nMatched Skills:')
  result.matches.forEach(match => {
    console.log(`  - ${match.skill.frontmatter.name} (${Math.round(match.confidence * 100)}%)`)
    console.log(`    Reason: ${match.reason}`)
  })

  console.log('\nActivated Skills:', result.activated.map(s => s.frontmatter.name))
  console.log('\nEstimated Tokens:', result.activated.reduce((sum, s) => sum + s.estimatedTokens, 0))

  // Get the LLM context to inject into your prompt
  const llmContext = system.generatePrompt()
  console.log('\n=== LLM Context ===')
  console.log(llmContext.substring(0, 500) + '...')
}

/**
 * Example 2: Explicit skill activation
 */
async function explicitActivation() {
  console.log('\n=== Example 2: Explicit Activation ===\n')

  const system = new SkillSystem()
  await system.initialize()

  // Manually activate a specific skill
  const skill = await system.activateSkill(
    'react-components',
    'User explicitly requested React skill'
  )

  if (skill) {
    console.log(`Activated: ${skill.frontmatter.name}`)
    console.log(`Tokens: ~${skill.estimatedTokens}`)
    console.log(`Has Reference: ${skill.reference ? 'Yes' : 'No'}`)
    console.log(`Has Examples: ${skill.examples ? 'Yes' : 'No'}`)
  }
}

/**
 * Example 3: Event listening
 */
async function eventListening() {
  console.log('\n=== Example 3: Event Listening ===\n')

  const system = new SkillSystem({ debug: false })

  // Listen for skill activation
  system.on('skill:activated', ({ skill, context }) => {
    console.log(`✅ Skill activated: ${skill.frontmatter.name}`)
    console.log(`   Tokens: ~${skill.estimatedTokens}`)
    console.log(`   Total active tokens: ${context.totalTokens}`)
  })

  // Listen for skill matching
  system.on('skill:matched', ({ match }) => {
    console.log(`🎯 Skill matched: ${match.skill.frontmatter.name} (${Math.round(match.confidence * 100)}%)`)
  })

  // Listen for errors
  system.on('error', ({ error }) => {
    console.error(`❌ Error: ${error.message}`)
  })

  await system.initialize()
  await system.processRequest('Build a REST API with Express and TypeScript')
}

/**
 * Example 4: Managing active skills and token budget
 */
async function tokenManagement() {
  console.log('\n=== Example 4: Token Management ===\n')

  const system = new SkillSystem({
    maxActiveSkills: 2, // Limit to 2 concurrent skills
    debug: true,
  })

  await system.initialize()

  // First request
  await system.processRequest('Create a React component')

  console.log('\nStats after first request:')
  const stats1 = system.getStats()
  console.log(`  Active skills: ${stats1.activeSkills}`)
  console.log(`  Active tokens: ${stats1.activeTokens}`)

  // Second request - might activate more skills
  await system.processRequest('Add API integration with fetch')

  console.log('\nStats after second request:')
  const stats2 = system.getStats()
  console.log(`  Active skills: ${stats2.activeSkills}`)
  console.log(`  Active tokens: ${stats2.activeTokens}`)

  // Deactivate a skill to free tokens
  system.deactivateSkill('react-components')

  console.log('\nStats after deactivation:')
  const stats3 = system.getStats()
  console.log(`  Active skills: ${stats3.activeSkills}`)
  console.log(`  Active tokens: ${stats3.activeTokens}`)
}

/**
 * Example 5: Using with context hints
 */
async function contextHints() {
  console.log('\n=== Example 5: Context Hints ===\n')

  const system = new SkillSystem()
  await system.initialize()

  // Provide context to improve matching
  const result = await system.processRequest(
    'Add authentication',
    {
      context: {
        currentFile: 'src/auth/login.tsx',
        recentTools: ['Read', 'Edit', 'WebFetch'],
        projectType: 'react',
      },
    }
  )

  console.log('Matched with context:')
  result.matches.forEach(match => {
    console.log(`  - ${match.skill.frontmatter.name} (${Math.round(match.confidence * 100)}%)`)
    console.log(`    Keywords: ${match.matchedKeywords.join(', ')}`)
  })
}

/**
 * Example 6: Statistics and monitoring
 */
async function statistics() {
  console.log('\n=== Example 6: Statistics ===\n')

  const system = new SkillSystem()
  await system.initialize()

  // Make several requests
  await system.processRequest('Create React component')
  await system.processRequest('Add TypeScript types')
  await system.processRequest('Write unit tests')

  // Get comprehensive stats
  const stats = system.getStats()

  console.log('System Statistics:')
  console.log(`  Total skills discovered: ${stats.totalSkills}`)
  console.log(`  Skills by source:`)
  console.log(`    - Project: ${stats.bySource.project}`)
  console.log(`    - User: ${stats.bySource.user}`)
  console.log(`    - Plugin: ${stats.bySource.plugin}`)
  console.log(`  Discovery tokens: ~${stats.discoveryTokens}`)
  console.log(`  Currently active: ${stats.activeSkills}`)
  console.log(`  Active tokens: ~${stats.activeTokens}`)
  console.log(`  Total activations: ${stats.totalActivations}`)
  console.log(`  Average confidence: ${(stats.averageConfidence * 100).toFixed(1)}%`)
}

/**
 * Example 7: Tool restrictions
 */
async function toolRestrictions() {
  console.log('\n=== Example 7: Tool Restrictions ===\n')

  const system = new SkillSystem({ debug: true })
  await system.initialize()

  // Activate a skill that restricts tools
  const skill = await system.activateSkill(
    'code-review', // Assume this skill only allows Read, Grep, Glob
    'Review this code'
  )

  if (skill) {
    const activeSkills = system.getActiveSkills()
    console.log('\nActive skills:', activeSkills.map(s => s.frontmatter.name))

    // Check allowed tools
    const executor = (system as any).executor
    const allowedTools = executor.getAllowedTools()
    const restrictedTools = executor.getRestrictedTools()

    console.log('\nAllowed tools:', allowedTools.join(', '))
    console.log('Restricted tools:', restrictedTools.join(', '))
  }
}

/**
 * Example 8: Integrating with an LLM
 */
async function llmIntegration() {
  console.log('\n=== Example 8: LLM Integration ===\n')

  const system = new SkillSystem()
  await system.initialize()

  const userMessage = 'Create a REST API endpoint for user authentication'

  // Process request and get context
  const { activated } = await system.processRequest(userMessage)

  if (activated.length > 0) {
    // Generate the skill context
    const skillContext = system.generatePrompt()

    // Build your LLM prompt
    const fullPrompt = `
${skillContext}

---

User Request: ${userMessage}

Please help with this request using the active skills above.
`

    console.log('Generated prompt for LLM:')
    console.log(fullPrompt)

    // In real usage, you'd send this to your LLM:
    // const response = await llm.complete(fullPrompt)
  } else {
    console.log('No skills activated, proceed with normal LLM interaction')
  }
}

/**
 * Run all examples
 */
async function runAllExamples() {
  const examples = [
    basicUsage,
    explicitActivation,
    eventListening,
    tokenManagement,
    contextHints,
    statistics,
    toolRestrictions,
    llmIntegration,
  ]

  for (const example of examples) {
    try {
      await example()
    } catch (error) {
      console.error(`Error in ${example.name}:`, error)
    }
  }
}

// Export for testing
export {
  basicUsage,
  explicitActivation,
  eventListening,
  tokenManagement,
  contextHints,
  statistics,
  toolRestrictions,
  llmIntegration,
  runAllExamples,
}

// Run if executed directly
if (require.main === module) {
  runAllExamples()
    .then(() => console.log('\n✅ All examples completed'))
    .catch(error => console.error('\n❌ Examples failed:', error))
}
