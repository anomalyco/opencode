## Style Guide

- Try to keep things in one function unless composable or reusable
- AVOID unnecessary destructuring of variables. instead of doing `const { a, b }
= obj` just reference it as obj.a and obj.b. this preserves context
- AVOID `try`/`catch` where possible
- AVOID `else` statements
- AVOID using `any` type
- AVOID `let` statements
- PREFER single word variable names where possible
- Use as many bun apis as possible like Bun.file()
