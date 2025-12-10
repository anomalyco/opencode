#!/usr/bin/env bun
import { getAllAgents, getAgent } from './packages/forge/src/acp/agents.ts';

const agents = getAllAgents();
console.log(`Total agents: ${agents.length}`);

const fastAgent = getAgent('Fast Agent');
if (fastAgent) {
  console.log('\nFast Agent found!');
  console.log('Configuration:', JSON.stringify(fastAgent, null, 2));
} else {
  console.log('\nFast Agent NOT found!');
  process.exit(1);
}
