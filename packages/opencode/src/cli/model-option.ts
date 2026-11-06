// Utilities already use -m for other options, so only the long flag is inherited.
export const modelOption = {
  type: "string" as const,
  describe: "model to use in the format of provider/model",
  // A later explicit selection overrides a launcher's model prefix, including across aliases.
  coerce: (value: string | string[]) => (Array.isArray(value) ? value.at(-1) : value),
}

export const modelOptionWithAlias = { ...modelOption, alias: ["m"] }
