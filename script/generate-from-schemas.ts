#!/usr/bin/env bun

import { $ } from "bun"
import Ajv from "ajv"
import addFormats from "ajv-formats"
import { readdir, readFile, writeFile, mkdir } from "fs/promises"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

// Setup paths
const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = join(__dirname, "..", "schema")
const OUTPUT_DIR = join(__dirname, "..", "packages", "opencode", "generated", "validators")

// Colors for console output
const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
}

async function validateSchemas() {
  console.log("🔍 Validating JSON Schemas...")

  const ajv = new Ajv({
    allErrors: true,
    strict: false, // Allow custom x- keywords
    allowUnionTypes: true,
  })
  addFormats(ajv)

  // Read all schema files
  const files = await readdir(SCHEMA_DIR)
  const schemaFiles = files.filter((f) => f.endsWith(".schema.json"))

  if (schemaFiles.length === 0) {
    console.log(`${colors.red}✗ No schema files found in ${SCHEMA_DIR}${colors.reset}`)
    process.exit(1)
  }

  // First pass: Load all schemas
  const schemas = new Map()
  for (const file of schemaFiles) {
    const path = join(SCHEMA_DIR, file)
    const content = await readFile(path, "utf-8")
    try {
      const schema = JSON.parse(content)
      schemas.set(file, { schema, path })
    } catch (error) {
      console.log(`${colors.red}✗ ${file} - Invalid JSON: ${error.message}${colors.reset}`)
      process.exit(1)
    }
  }

  // Second pass: Add all schemas to AJV without $id for file-based refs
  for (const [file, { schema }] of schemas) {
    try {
      // Create a copy without $id so filename-based $ref works
      const schemaForValidation = JSON.parse(JSON.stringify(schema))
      delete schemaForValidation.$id
      delete schemaForValidation.$schema

      ajv.addSchema(schemaForValidation, file)
    } catch (err) {
      // Schema might already exist, that's ok
    }
  }

  // Third pass: Validate each schema
  let allValid = true
  for (const [file, { schema }] of schemas) {
    try {
      // Create validation copy without $id/$schema
      const schemaForValidation = JSON.parse(JSON.stringify(schema))
      delete schemaForValidation.$id
      delete schemaForValidation.$schema

      // Validate schema structure
      ajv.compile(schemaForValidation)
      console.log(`${colors.green}✓${colors.reset} ${file} - valid`)
    } catch (error) {
      console.log(`${colors.red}✗ ${file} - ${error.message}${colors.reset}`)
      allValid = false
    }
  }

  if (!allValid) {
    console.log(`\n${colors.red}Schema validation failed!${colors.reset}`)
    process.exit(1)
  }

  console.log(`\n${colors.green}✓ All ${schemaFiles.length} schemas validated successfully${colors.reset}\n`)
  return schemas
}

function jsonSchemaToZod(schema: any, refMap: Map<string, string>, depth = 0): string {
  // Handle $ref
  if (schema.$ref) {
    const refFile = schema.$ref
    const refName = refFile.replace(".schema.json", "")
    return refName + "Schema"
  }

  // Handle basic types
  if (schema.type === "string") {
    if (schema.enum) {
      const values = schema.enum.map((v) => `"${v}"`).join(", ")
      return `z.enum([${values}])`
    }
    return "z.string()"
  }

  if (schema.type === "number" || schema.type === "integer") {
    return "z.number()"
  }

  if (schema.type === "boolean") {
    return "z.boolean()"
  }

  if (schema.type === "array") {
    const items = schema.items ? jsonSchemaToZod(schema.items, refMap, depth + 1) : "z.any()"
    return `z.array(${items})`
  }

  if (schema.type === "object") {
    if (schema.additionalProperties === true) {
      return "z.record(z.string(), z.any())"
    }
    if (schema.additionalProperties) {
      const valueType = jsonSchemaToZod(schema.additionalProperties, refMap, depth + 1)
      return `z.record(z.string(), ${valueType})`
    }
    if (schema.properties) {
      const props = Object.entries(schema.properties).map(([key, prop]: [string, any]) => {
        let zodType = jsonSchemaToZod(prop, refMap, depth + 1)
        const required = schema.required?.includes(key)
        if (!required) {
          zodType += ".optional()"
        }
        return `    ${key}: ${zodType},`
      })
      return `z.object({\n${props.join("\n")}\n  })`
    }
    return "z.record(z.string(), z.any())"
  }

  // Handle unions
  if (schema.oneOf || schema.anyOf) {
    const schemas = schema.oneOf || schema.anyOf
    const types = schemas.map((s: any) => jsonSchemaToZod(s, refMap, depth + 1))
    return `z.union([${types.join(", ")}])`
  }

  return "z.any()"
}

async function generateZodValidators(schemas: Map<string, any>) {
  console.log("🔧 Generating Zod validators...")

  // Create output directory
  await mkdir(OUTPUT_DIR, { recursive: true })

  // Build reference map (filename -> schema name)
  const refMap = new Map()
  for (const [file, { schema }] of schemas) {
    const name = file.replace(".schema.json", "")
    refMap.set(file, name)
  }

  // Generate each schema
  for (const [file, { schema }] of schemas) {
    const schemaName = file.replace(".schema.json", "")
    const outputPath = join(OUTPUT_DIR, `${schemaName}.ts`)

    // Collect all $refs in this schema to generate imports
    const refs = new Set<string>()
    function collectRefs(obj: any) {
      if (!obj || typeof obj !== "object") return
      if (obj.$ref) {
        refs.add(obj.$ref.replace(".schema.json", ""))
      }
      for (const value of Object.values(obj)) {
        collectRefs(value)
      }
    }
    collectRefs(schema)

    // Generate imports
    const imports = Array.from(refs)
      .filter((ref) => ref !== schemaName)
      .map((ref) => `import { ${ref}Schema } from "./${ref}"`)
      .join("\n")

    // Generate Zod schema
    const zodSchema = jsonSchemaToZod(schema, refMap)

    // Generate type export
    const exportName = `${schemaName}Schema`
    const typeName = schemaName.charAt(0).toUpperCase() + schemaName.slice(1)

    const content = `import { z } from "zod"
${imports ? imports + "\n" : ""}
export const ${exportName} = ${zodSchema}

export type ${typeName} = z.infer<typeof ${exportName}>
`

    await writeFile(outputPath, content)
    console.log(`${colors.green}✓${colors.reset} ${schemaName}.ts - generated`)
  }

  console.log(`\n${colors.green}✓ Code generation complete${colors.reset}`)
}

async function main() {
  console.log("🚀 JSON Schema Validation & Code Generation\n")

  const schemas = await validateSchemas()
  await generateZodValidators(schemas)

  console.log("\n✨ Done!")
}

main().catch((error) => {
  console.error(`${colors.red}Error: ${error.message}${colors.reset}`)
  process.exit(1)
})
