#!/usr/bin/env node
// Simple proofreading agent to check GitHub comment text before submission.
// - Detects literal "\n" sequences that indicate escaped newlines
// - Detects trailing spaces and double spaces
// - Can auto-fix escaped newlines into real newlines when run with --fix

const fs = require('fs')

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => data += chunk)
    process.stdin.on('end', () => resolve(data))
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const fix = argv.includes('--fix')
  const fileArg = argv.find(a => a !== '--fix')
  let text = ''

  if (fileArg) {
    text = fs.readFileSync(fileArg, 'utf8')
  } else {
    text = await readStdin()
  }

  const issues = []

  if (/\\n/.test(text)) {
    issues.push({type: 'escaped-newline', message: 'Found literal "\n" sequences (escaped newlines). Consider replacing with real newlines.'})
  }

  if (/\s+$/.test(text)) {
    issues.push({type: 'trailing-space', message: 'Trailing whitespace detected at end of text.'})
  }

  if (/ {2,}/.test(text)) {
    issues.push({type: 'double-space', message: 'Found double (or more) consecutive spaces.'})
  }

  if (issues.length === 0) {
    console.log('Proofreader: No obvious issues found.')
    process.exit(0)
  }

  console.log('Proofreader: Found issues:')
  issues.forEach((i, idx) => console.log(`${idx+1}. [${i.type}] ${i.message}`))

  if (fix) {
    let fixed = text.replace(/\\n/g, '\n')
    fixed = fixed.replace(/[ \t]+$/gm, '')
    // collapse 3+ spaces to single space, leave double spaces after sentences alone is conservative
    fixed = fixed.replace(/ {3,}/g, ' ')

    if (fileArg) {
      fs.writeFileSync(fileArg, fixed, 'utf8')
      console.log('\nAuto-fixed file in place:', fileArg)
    } else {
      process.stdout.write(fixed)
    }
    process.exit(0)
  }

  process.exit(2)
}

main().catch(err => { console.error(err); process.exit(1) })
