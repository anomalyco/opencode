import { cmd } from "./cmd";
import { Session } from "../../session";
import { Log } from "../../util/log";
import { Message } from "../../session/message";

export const SessionLoopCommand = cmd({
  command: "session-loop <modelA> <modelB>",
  describe: "Start an autonomous loop between two sessions",
  builder: (yargs) =>
    yargs
      .positional("modelA", {
        describe: "Model ID for Session A",
        type: "string",
        demandOption: true,
      })
      .positional("modelB", {
        describe: "Model ID for Session B",
        type: "string",
        demandOption: true,
      })
      .option("message", {
        alias: "m",
        describe: "Initial message to send to Session A",
        type: "string",
        demandOption: true,
      }),
  handler: async (args) => {
    const log = Log.create({ service: "session-loop" });
    log.info("Starting session loop", { args });

    try {
      const sessionA = await Session.create();
      const sessionB = await Session.create();

      log.info("Sessions created", { sessionAId: sessionA.id, sessionBId: sessionB.id });

      let currentMessageContent = args.message;
      let loopCount = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        loopCount++;
        log.info(`Loop ${loopCount}: Sending to Session A`);

        // Send to Session A
        const responseA = await Session.chat({
          sessionID: sessionA.id,
          providerID: args.modelA.split("/")[0], // Assuming format provider/model
          modelID: args.modelA.split("/")[1],
          parts: [{ type: "text", text: currentMessageContent }],
        });

        if (!responseA) {
          log.error("Session A did not return a response.");
          break;
        }
        currentMessageContent = Message.extractText(responseA);
        log.info("Session A response", { content: currentMessageContent });

        // Send to Session B
        log.info(`Loop ${loopCount}: Relaying to Session B`);
        const responseB = await Session.chat({
          sessionID: sessionB.id,
          providerID: args.modelB.split("/")[0], // Assuming format provider/model
          modelID: args.modelB.split("/")[1],
          parts: [{ type: "text", text: currentMessageContent }],
        });

        if (!responseB) {
          log.error("Session B did not return a response.");
          break;
        }
        currentMessageContent = Message.extractText(responseB);
        log.info("Session B response", { content: currentMessageContent });

        // Basic safety break for now, can be made more sophisticated
        if (loopCount > 100) {
            log.warn("Loop limit reached. Exiting.");
            break;
        }
        // Add a small delay to avoid overwhelming APIs or hitting rate limits too quickly
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      log.error("Error in session loop", { error });
      console.error("An error occurred during the session loop. See logs for details.");
    }
  },
});
