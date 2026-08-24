import path from "path"

process.env.PENCODE_DB = ":memory:"
process.env.PENCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.PENCODE_DISABLE_MODELS_FETCH = "true"
