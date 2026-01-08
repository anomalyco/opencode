# Test Commands for Issue #7 - newString undefined Bug

## Test 1: Normal edit (should work)
```bash
echo "Test 1: Normal edit"
```

## Test 2: Create a test file
```bash
echo "Hello World" > test-file.txt
```

## Test 3: Edit the file (this tests newString handling)
```edit
filePath: test-file.txt
oldString: Hello World
newString: Hello OpenCode
```

## Test 4: Verify the edit worked
```bash
cat test-file.txt
```

## Test 5: Test with empty newString (should fail gracefully)
```edit
filePath: test-file.txt
oldString: Hello OpenCode
newString: 
```

## Test 6: Test with Unicode content
```edit
filePath: test-file.txt
oldString: Hello OpenCode
newString: Hello — World
```

## Test 7: Test with multi-line content
```edit
filePath: test-file.txt
oldString: Hello — World
newString: Line 1
Line 2
Line 3
```

## Cleanup
```bash
del test-file.txt
```

---

## Expected Behavior After Fix

**Test 3:** Should succeed - newString is properly passed
**Test 5:** Should throw clear error: "newString parameter is required but was undefined"
**Test 6:** Should succeed - Unicode handled correctly
**Test 7:** Should succeed - multi-line content handled correctly

## Before Fix (if bug exists)

Test 3 would fail with:
```
Error: The edit tool was called with invalid arguments: [
  {
    "expected": "string",
    "code": "invalid_type",
    "path": ["newString"],
    "message": "Invalid input: expected string, received undefined"
  }
]
```

## After Fix (current state)

All tests should either succeed or fail with clear error messages from the validation guard.
