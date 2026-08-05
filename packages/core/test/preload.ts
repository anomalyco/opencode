import path from "path"

process.env.LEAKCODE_DB = ":memory:"
process.env.LEAKCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.LEAKCODE_DISABLE_MODELS_FETCH = "true"
