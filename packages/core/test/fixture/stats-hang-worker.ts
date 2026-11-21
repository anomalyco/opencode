// Test fixture worker that stays alive without replying so tests can verify
// Fiber.interrupt terminates an in-flight stats worker cleanly.
const timer = setInterval(() => {}, 60_000)
void timer
