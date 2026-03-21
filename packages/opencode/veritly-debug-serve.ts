import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir);
const opencodeRoot = path.resolve(packageRoot, "..", "..");
const repoRoot = path.resolve(packageRoot, "..", "..", "..", "..");
const managedDir = path.join(opencodeRoot, ".veritly", ".managed-opencode");
const managedInstructionsPath = path.join(managedDir, "veritly-instructions.md");
const examplesPath = path.join(opencodeRoot, "packages", "veritly-components", "examples.md");
const userInstructionsPath = path.join(os.homedir(), ".config", "opencode", "AGENTS.md");

function log(message: string) {
	console.log(`[veritly-debug-serve] ${message}`);
}

async function readOptional(filePath: string) {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

const examples = await readFile(examplesPath, "utf8");
const userInstructions = await readOptional(userInstructionsPath);

await mkdir(managedDir, { recursive: true });

const content = [
	"# Veritly managed instructions",
	"",
	examples.trimEnd(),
	userInstructions
		? ["", "---", "", "# User instructions", "", userInstructions.trimEnd()].join("\n")
		: "",
	"",
].join("\n");

await writeFile(managedInstructionsPath, content, "utf8");

if (!process.env.OPENCODE_PROJECTS_ROOT) {
	process.env.OPENCODE_PROJECTS_ROOT = path.join(repoRoot, ".veritly", "projects");
}

process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
	instructions: [managedInstructionsPath],
});

log(`root=${opencodeRoot}`);
log(`generated=${managedInstructionsPath}`);
log(`opencode_projects_root=${process.env.OPENCODE_PROJECTS_ROOT}`);

// Make the downstream CLI parse as `opencode serve --port 4096`.
process.argv = [process.argv[0] ?? "bun", path.join(packageRoot, "src", "index.ts"), "serve", "--port", "4096"];

await import("./src/index.ts");
