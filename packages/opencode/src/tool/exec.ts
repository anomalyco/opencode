import { tool } from "../tool.js";
import { execFile } from "child_process";
import os from "os";

export const exec = tool(
  {
    description:
      "Execute a command with arguments. The command will be executed in the user's home directory. This tool does not support shell features like pipes or redirection.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "The executable file to run.",
        },
        args: {
          type: "array",
          description: "The list of string arguments to pass to the command.",
          items: {
            type: "string",
          },
          default: [],
        },
      },
      required: ["file"],
    },
  },
  async (params) => {
    const { file, args = [] } = params;
    const result = await new Promise<string>((resolve, reject) => {
      execFile(file, args, { cwd: os.homedir() }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Error: ${error.message}\nStderr: ${stderr}`));
          return;
        }
        resolve(stdout);
      });
    });
    return result;
  }
);
