// Test plugin to verify JS loading works
export const TestJSPlugin = async ({ app, client, $ }) => {
  console.log("JavaScript plugin loaded successfully!")

  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        console.log("JS Plugin: Session idle event received")
      }
    },
  }
}
