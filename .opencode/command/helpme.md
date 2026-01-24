---
description: Request help with a situation you've been discussing in empathy listener sessions
agent: empathy
---

The user is explicitly requesting help. This triggers SOLUTION MODE.

## Your Steps:

1. **Get the active thread**: Use `empathy_list_threads` to find the active thread

2. **Retrieve full context**: Use `empathy_retrieve` to get all relevant history

3. **Acknowledge the request**: Let them know you're switching to solution mode

4. **Analyze the situation thoroughly**:
   - Review the running summary
   - Look at key themes
   - Consider recent entries and high-importance past entries
   - Understand the full picture before offering help

5. **Provide structured help**:
   - Summarize your understanding of the situation
   - Identify the core challenge(s)
   - Break down the problem
   - Offer concrete, actionable steps
   - Acknowledge what's in their control vs what isn't
   - Consider multiple perspectives

6. **Store this exchange**: Use `empathy_store` with:
   - `importance: 10` (HELP ME requests are always high importance)
   - `helpRequest: true`
   - Include the situation summary and your recommendations

7. **Follow up**: After providing help, check in with how it lands for them

## User's request:

$ARGUMENTS
