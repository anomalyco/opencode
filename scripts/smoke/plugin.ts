import { AdvancedToolsPlugin } from "../../.opencode/plugins/advanced-tools.ts";

async function run() {
  console.log("🚀 Starting Smoke Test for Advanced Tools Plugin...");
  let yelled = false;
  
  // Create a mock context representing the OpenCode environment
  const mockContext = {
    client: {
      app: {
        log: async (msg: any) => {
          if (msg.body.level === "error") {
            console.log(`\n🔴 [UI ALERT DISPLAYED TO USER]: ${msg.body.message}`);
            yelled = true;
          }
        }
      }
    },
    $: async () => {}, // Mock bun shell
    directory: "/mock/dir",
    worktree: "/mock/worktree"
  } as any;

  const plugin = await AdvancedToolsPlugin(mockContext);
  
  if (plugin.tool) {
    console.log("✅ All tools registered in plugin:");
    console.log("   ->", Object.keys(plugin.tool).join(", "));
  }

  console.log("\n✅ Testing agent task registration...");
  const systemContext: any = { system: [] };
  if (plugin["experimental.chat.system.transform"]) {
    await plugin["experimental.chat.system.transform"]({} as any, systemContext);
    console.log("   -> Agent instruction snippet injected into system prompt!");
  }

  if (plugin.tool?.repo_architect) {
    console.log("\n✅ Testing successful tool execution...");
    const res = await plugin.tool.repo_architect.execute({ directory: "src" }, mockContext as any);
    console.log("   -> Result:", res);

    console.log("\n🔥 Testing forcing a tool to fail and checking if it yells at the UI...");
    try {
      await plugin.tool.repo_architect.execute({ directory: "trigger_error" }, mockContext as any);
    } catch (e: any) {
      console.log("   -> Exception caught by UI Framework:", e.message);
    }
  }

  if (yelled) {
    console.log("\n🎉 Smoke Test PASSED: Plugin successfully yells errors straight to the UI!");
  } else {
    console.error("\n❌ Smoke Test FAILED: Did not yield error to UI.");
    process.exit(1);
  }
}

run().catch(console.error);
