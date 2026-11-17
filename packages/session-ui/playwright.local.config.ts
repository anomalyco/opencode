import base from "./playwright.components.config"
export default { ...base, projects: base.projects?.map((p) => ({ ...p, use: { ...p.use, channel: "chrome" } })) }
