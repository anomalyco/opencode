// This plugin throws an error during initialization
export const FailingPlugin = async (context) => {
  throw new Error("Plugin initialization failed")
}

// This plugin has invalid structure
export const InvalidStructurePlugin = async (context) => {
  return "not an object with hooks"
}

// This export is not a function
export const NotAFunction = {
  someProperty: "value",
}
