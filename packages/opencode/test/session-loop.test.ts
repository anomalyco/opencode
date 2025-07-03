import { describe, it, expect, vi, beforeEach } from "bun:test";
import { SessionLoopCommand } from "../src/cli/cmd/session-loop";
import { Session } from "../src/session";
import { Message } from "../src/session/message";

// Mock Session and Message modules
vi.mock("../src/session", () => ({
  Session: {
    create: vi.fn(),
    chat: vi.fn(),
  },
}));

vi.mock("../src/session/message", () => ({
  Message: {
    extractText: vi.fn(),
  },
}));

describe("SessionLoopCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should correctly parse arguments and initiate loop (basic test)", async () => {
    const mockSessionAId = "session-a-id";
    const mockSessionBId = "session-b-id";
    const initialMessage = "Hello Agent A";
    const responseFromA = "Hello Agent B";
    const responseFromB = "Loop back to A";

    (Session.create as vi.Mock)
      .mockResolvedValueOnce({ id: mockSessionAId })
      .mockResolvedValueOnce({ id: mockSessionBId });

    (Session.chat as vi.Mock)
      .mockResolvedValueOnce({ id: "msg-a-1", parts: [{type: "text", text: responseFromA}] }) // A's first response
      .mockResolvedValueOnce({ id: "msg-b-1", parts: [{type: "text", text: responseFromB}] }) // B's first response
      .mockResolvedValueOnce({ id: "msg-a-2", parts: [{type: "text", text: "Final A"}] }); // A's second response (loop will break before this usually)


    (Message.extractText as vi.Mock)
      .mockReturnValueOnce(responseFromA)
      .mockReturnValueOnce(responseFromB)
      .mockReturnValueOnce("Final A");

    const args = {
      modelA: "providerA/model1",
      modelB: "providerB/model2",
      message: initialMessage,
      // yargs specific properties, adjust as needed if your cmd setup is different
      _: ["session-loop"],
      $0: "opencode",
    };

    // Temporarily override console.error and Log.create to spy on them
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logInfoSpy = vi.fn();
    const logErrorSpy = vi.fn();
    const logWarnSpy = vi.fn();

    vi.mock("../src/util/log", () => ({
        Log: {
            create: vi.fn(() => ({
                info: logInfoSpy,
                error: logErrorSpy,
                warn: logWarnSpy,
            })),
        }
    }));

    // To prevent the loop from running indefinitely in the test,
    // we can mock setTimeout to execute immediately or track calls.
    // For this basic test, we'll rely on the loopCount break inside the handler.
    // More sophisticated tests might involve controlling the loop externally.

    await SessionLoopCommand.handler(args as any); // Cast to any to satisfy yargs input

    expect(Session.create).toHaveBeenCalledTimes(2);
    expect(Session.chat).toHaveBeenCalledTimes(2); // Assuming loop breaks after 1 full cycle for this test by internal logic or mock

    expect(Session.chat).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        sessionID: mockSessionAId,
        providerID: "providerA",
        modelID: "model1",
        parts: [{ type: "text", text: initialMessage }],
      })
    );
    expect(Message.extractText).toHaveBeenNthCalledWith(1, { id: "msg-a-1", parts: [{type: "text", text: responseFromA}] });

    expect(Session.chat).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        sessionID: mockSessionBId,
        providerID: "providerB",
        modelID: "model2",
        parts: [{ type: "text", text: responseFromA }],
      })
    );
    expect(Message.extractText).toHaveBeenNthCalledWith(2, { id: "msg-b-1", parts: [{type: "text", text: responseFromB}] });

    // Check logs (optional, but good for verifying behavior)
    expect(logInfoSpy).toHaveBeenCalledWith("Starting session loop", { args });
    expect(logInfoSpy).toHaveBeenCalledWith("Sessions created", { sessionAId: mockSessionAId, sessionBId: mockSessionBId });
    expect(logInfoSpy).toHaveBeenCalledWith("Loop 1: Sending to Session A");
    expect(logInfoSpy).toHaveBeenCalledWith("Session A response", { content: responseFromA });
    expect(logInfoSpy).toHaveBeenCalledWith("Loop 1: Relaying to Session B");
    expect(logInfoSpy).toHaveBeenCalledWith("Session B response", { content: responseFromB });
    // Depending on how the loop breaks (e.g. count limit), this might or might not be called for the next iteration
    // expect(logInfoSpy).toHaveBeenCalledWith("Loop 2: Sending to Session A");

    consoleErrorSpy.mockRestore();
  });

  // Add more tests:
  // - Test error handling (e.g., if Session.create or Session.chat throws an error)
  // - Test different loop termination conditions (if applicable)
  // - Test tool usage (more complex, might require deeper mocking of Session.chat and tool execution)
});
