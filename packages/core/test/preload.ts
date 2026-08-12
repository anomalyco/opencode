import path from "path"

process.env.MOKS_DB = ":memory:"
process.env.MOKS_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.MOKS_DISABLE_MODELS_FETCH = "true"
