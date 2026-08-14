// Spike shim: mime-types requires mime-db's JSON database, which the module
// fallback service cannot serve. The workerd profile stubs FileSystem, so
// mime lookups never influence behavior here.
export const lookup = () => false
export const contentType = () => false
export const extension = () => false
export const charset = () => false
export const types = {}
export const extensions = {}
export default { lookup, contentType, extension, charset, types, extensions }
