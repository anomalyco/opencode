// This plugin throws an error during initialization
export const FailingPlugin = async (_context: any) => {
  throw new Error("Plugin initialization failed")
}

// This plugin has invalid structure
export const InvalidStructurePlugin = async (_context: any) => {
  return "not an object with hooks"
}

// This export is not a function
export const NotAFunction = {
  someProperty: "value",
}
