export interface ToolSchema {
  input: Record<string, string>
  output: Record<string, string>
}

export interface ToolFile {
  name: string
  description: string
  schema: ToolSchema
}

export interface ToolSignature {
  name: string
  description: string
  input: Record<string, string>
  output: Record<string, string>
}

export interface ToolEntityContent {
  file_path: string
  input_schema: Record<string, string>
  output_schema: Record<string, string>
}
