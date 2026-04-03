// Map XCSH_* environment variables to OPENCODE_* for backward compatibility.
// This shim allows users to set either prefix. XCSH_* takes priority when
// the corresponding OPENCODE_* variable is not already set.
// Imported before any other module so flags see the mapped values.
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("XCSH_") && value !== undefined) {
    const legacyKey = "OPENCODE_" + key.slice(5)
    if (process.env[legacyKey] === undefined) {
      process.env[legacyKey] = value
    }
  }
}
