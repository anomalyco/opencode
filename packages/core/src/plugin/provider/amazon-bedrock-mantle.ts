export const mantleAPI = (modelID: string): "chat" | "responses" => {
  // AWS exposes safeguard models through Chat Completions only; Responses rejects them with HTTP 400.
  if (modelID === "openai.gpt-oss-safeguard-20b" || modelID === "openai.gpt-oss-safeguard-120b") return "chat"
  return "responses"
}
