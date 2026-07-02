// Worker fixture: crashes immediately with an uncaught exception
// Used by rpc-hang.test.ts to test real Worker death scenarios
throw new Error("Worker crashed on purpose")
