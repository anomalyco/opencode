import Parser from "tree-sitter";
import Bash from "tree-sitter-bash";

const parser = new Parser();
parser.setLanguage(Bash.language as any);

const sourceCode = `cd --foo foo/bar && echo "hello" && cd ../baz`;

const tree = parser.parse(sourceCode);

// Function to extract commands and arguments
function extractCommands(
  node: any,
): Array<{ command: string; args: string[] }> {
  const commands: Array<{ command: string; args: string[] }> = [];

  function traverse(node: any) {
    if (node.type === "command") {
      const commandNode = node.child(0);
      if (commandNode) {
        const command = commandNode.text;
        const args: string[] = [];

        // Extract arguments
        for (let i = 1; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type === "word") {
            args.push(child.text);
          }
        }

        commands.push({ command, args });
      }
    }

    // Traverse children
    for (let i = 0; i < node.childCount; i++) {
      traverse(node.child(i));
    }
  }

  traverse(node);
  return commands;
}

// Extract and display commands
console.log("Source code: " + sourceCode);
const commands = extractCommands(tree.rootNode);
console.log("Extracted commands:");
commands.forEach((cmd, index) => {
  console.log(`${index + 1}. Command: ${cmd.command}`);
  console.log(`   Args: [${cmd.args.join(", ")}]`);
});
