// This plugin will fail to import due to syntax error
export const SyntaxErrorPlugin = async () => {
  return {
    "chat.message": async () => {
      // Missing closing brace to cause syntax error
}