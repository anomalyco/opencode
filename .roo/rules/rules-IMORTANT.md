🧠 Rule: Manual Test Mode
Trigger: When tests or debugging are involved
Rule:

Don’t run or simulate tests automatically.
Just tell me exactly what to do manually and what info you need back.
Never use npm run dev or any variation of it.

🧠 Rule: Follow Svelte 5 + UnoCSS Best Practices
Trigger: When writing frontend components or styling UI
Rule:

Use Svelte 5 idioms — prefer <script> + reactive declarations, no legacy stores unless needed.
For styling, use UnoCSS utility classes — avoid inline styles and bloated class logic.
Only use semantic, minimal markup. Prefer readability over abstraction.

🧠 Rule: KISS (Keep It Simple, Stupid)
Trigger: Anytime code is being written or refactored
Rule:

Keep code as simple and clear as possible.
Avoid clever hacks, deep nesting, or overengineering.
If it looks confusing, rewrite it simpler.

🧠 Rule: SSOT (Single Source of Truth)
Trigger: When defining values like enums, constants, configs, or validation logic
Rule:

Define shared values in one file only.
Import and use them elsewhere — never duplicate.
Changing a value should require changing it in one place.