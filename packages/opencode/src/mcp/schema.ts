import Ajv from "ajv"
import addFormats from "ajv-formats"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"

// Ajv ignores formats it does not know (uint32/uint64 from Rust schemars, for
// example) but logs a warning for each one while compiling a schema. MCP tool
// output schemas are third-party input, so keep the SDK's validation behavior
// and only silence the logger.
// https://github.com/anomalyco/opencode/issues/31002
export function createJsonSchemaValidator() {
  const ajv = new Ajv({
    strict: false,
    validateFormats: true,
    validateSchema: false,
    allErrors: true,
    logger: false,
  })
  addFormats(ajv)
  return new AjvJsonSchemaValidator(ajv)
}

export * as McpSchema from "./schema"
