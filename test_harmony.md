# Testing Harmony Implementation

To test the Harmony template format implementation:

## 1. Start opencode with a Harmony model:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /home/genar/src/opencode
bun run dev --model lmstudio/openai/gpt-oss-20b
```

## 2. Alternative: Test with any model that has "gpt-oss" or "harmony" in the name:

```bash
# If you have access to other Harmony models:
bun run dev --model openai/gpt-oss-20b
bun run dev --model openai/harmony-model
```

## 3. What to expect:

### Before the fix:
- Raw Harmony tokens would appear: `<|channel|>analysis<|message|>content...`
- Broken display with template syntax visible
- Hard to read output

### After the fix:
- **Analysis sections** with muted styling and "▶ Analysis" header
- **Commentary sections** with secondary color and "▶ Commentary" header  
- **Final sections** with primary text and "▶ Response" header
- Clean, organized display with proper markdown rendering
- Copy functionality prioritizes final responses

## 4. Test Commands:

Once in opencode, try asking questions that would generate analysis and final responses:

```
Analyze this code and provide a final recommendation: console.log("hello")
```

```
Can you explain how JavaScript works? Provide analysis first, then a final summary.
```

## 5. Expected Behavior:

The model should respond using Harmony format internally, and opencode will:
1. **Parse** `<|channel|>analysis<|message|>...` tokens
2. **Render** each channel with appropriate styling
3. **Display** clean, organized sections instead of raw template syntax
4. **Allow copying** with preference for final channel content

## 6. Validation Points:

✅ No raw `<|channel|>` tokens visible in TUI
✅ Sections appear with colored headers (▶ Analysis, ▶ Commentary, ▶ Response)  
✅ Content is properly formatted markdown
✅ Copy functionality works and prefers final responses
✅ No broken display or template syntax showing through