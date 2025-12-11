import { qwenAuth } from "./src/provider/qwen-auth";

async function test() {
  console.log("Testing Qwen Auth...");
  try {
    const token = await qwenAuth.getAccessToken();
    console.log("Token retrieved:", token ? token.substring(0, 10) + "..." : "null");
    
    const response = await fetch("https://portal.qwen.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Origin": "https://chat.qwen.ai",
        "Referer": "https://chat.qwen.ai/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({
        model: "qwen-plus", // generic model to test auth
        messages: [{ role: "user", content: "hi" }]
      })
    });
    
    console.log("Response status:", response.status);
    const text = await response.text();
    console.log("Response body:", text);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
