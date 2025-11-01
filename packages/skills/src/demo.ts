/**
 * Simple working demo of the skill system
 */

import { SkillSystem } from './skill-system'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function demo() {
  console.log('='.repeat(80))
  console.log('SKILL SYSTEM DEMO')
  console.log('='.repeat(80))

  const skillsPath = join(__dirname, 'examples', 'example-skills')

  const system = new SkillSystem({
    projectSkillsPath: skillsPath,
    userSkillsPath: '/nonexistent',
    minConfidenceThreshold: 0.05, // Lower threshold for demo
    debug: true,
  })

  console.log('\n[1] INITIALIZING...\n')
  await system.initialize()

  const stats = system.getStats()
  console.log(`\n✅ Found ${stats.totalSkills} skills`)

  console.log('\n[2] PROCESSING REQUEST: "Create a React component with TypeScript"\n')
  const result = await system.processRequest('Create a React component with TypeScript')

  console.log(`\n✅ Activated ${result.activated.length} skills`)
  result.activated.forEach(skill => {
    console.log(`   - ${skill.frontmatter.name} (~${skill.estimatedTokens} tokens)`)
  })

  console.log('\n[3] GENERATED CONTEXT (first 500 chars):\n')
  const context = system.generatePrompt()
  console.log(context.substring(0, 500) + '...\n')

  console.log('='.repeat(80))
}

demo().catch(console.error)
