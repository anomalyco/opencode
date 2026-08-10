#!/usr/bin/env node
import fs from "fs";
import path from "path";

const COMPACTION_BUFFER = 20_000;
const PRUNE_MINIMUM = 5000;
const PRUNE_PROTECT = 30000;
const PRUNE_PROTECTED_TOOLS = ["skill"];

class TokenEstimator {
  static estimate(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }
}

class Message {
  constructor(id, role, content, options = {}) {
    this.id = id;
    this.role = role;
    this.content = content;
    this.parts = [];
    this.summary = options.summary || false;
    this.time = { created: Date.now() };
  }

  addToolPart(tool, output, status = "completed") {
    this.parts.push({
      type: "tool",
      tool,
      state: {
        status,
        output,
        time: { compacted: null }
      }
    });
  }

  addTextPart(text) {
    this.parts.push({
      type: "text",
      text
    });
  }
}

class SessionCompaction {
  constructor() {
    this.messages = [];
    this.logs = [];
  }

  log(message) {
    const timestamp = new Date().toLocaleTimeString();
    this.logs.push(`[${timestamp}] ${message}`);
    console.log(`[${timestamp}] ${message}`);
  }

  addMessage(message) {
    this.messages.push(message);
  }

  calculateTotalTokens() {
    let total = 0;
    for (const msg of this.messages) {
      if (msg.content) {
        total += TokenEstimator.estimate(msg.content);
      }
      for (const part of msg.parts) {
        if (part.type === "tool" && part.state.output && !part.state.time.compacted) {
          total += TokenEstimator.estimate(part.state.output);
        }
        if (part.type === "text") {
          total += TokenEstimator.estimate(part.text);
        }
      }
    }
    return total;
  }

  prune() {
    this.log("=== 开始剪枝 (Pruning) ===");
    
    let total = 0;
    let pruned = 0;
    const toPrune = [];
    let turns = 0;
    const msgs = [...this.messages];

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex];
      
      if (msg.role === "user") turns++;
      if (turns < 2) continue;
      
      if (msg.role === "assistant" && msg.summary) break loop;
      
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex];
        
        if (part.type === "tool" && part.state.status === "completed") {
          if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue;
          
          if (part.state.time.compacted) break loop;
          
          const estimate = TokenEstimator.estimate(part.state.output);
          total += estimate;
          
          this.log(`发现工具 ${part.tool}, 输出: ${estimate} tokens (累计: ${total})`);
          
          if (total > PRUNE_PROTECT) {
            pruned += estimate;
            toPrune.push(part);
            this.log(`  → 超过保护阈值 ${PRUNE_PROTECT}, 标记剪枝`);
          }
        }
      }
    }

    this.log(`剪枝统计: 可剪 ${pruned} tokens`);
    
    if (pruned > PRUNE_MINIMUM) {
      for (const part of toPrune) {
        part.state.time.compacted = Date.now();
      }
      this.log(`✅ 执行剪枝: ${toPrune.length} 个工具输出`);
    } else {
      this.log(`❌ 跳过剪枝: 不足 ${PRUNE_MINIMUM} tokens`);
    }
    
    return pruned;
  }

  generateSummary() {
    this.log("=== 生成压缩摘要 (Compaction) ===");
    
    const summary = `---
## Goal
用户想了解 opencode 的上下文管理机制，包括剪枝和压缩策略。

## Instructions
- 创建一个可运行的示例代码
- 演示剪枝和压缩的工作流程
- 用可视化的方式展示 token 变化

## Discoveries
- 剪枝是轻量级策略，只删除旧工具输出
- 压缩是重量级策略，用 AI 生成对话摘要
- 有两个关键阈值: PRUNE_PROTECT=40000, PRUNE_MINIMUM=20000

## Accomplished
- 已实现 TokenEstimator 类
- 已实现 Message 类
- 已实现剪枝逻辑
- 正在演示压缩逻辑

## Relevant files
- compaction.ts (参考原型)
- 本示例文件
---`;

    this.log(`生成摘要完成 (约 ${TokenEstimator.estimate(summary)} tokens)`);
    return summary;
  }

  compact() {
    const summary = this.generateSummary();
    
    const summaryMsg = new Message("summary-" + Date.now(), "assistant", "", { summary: true });
    summaryMsg.addTextPart(summary);
    
    this.log(`插入摘要消息`);
    
    const idx = this.messages.findIndex(m => m.role === "user");
    if (idx >= 0) {
      this.messages.splice(idx, 0, summaryMsg);
    } else {
      this.messages.unshift(summaryMsg);
    }
    
    return summary;
  }

  printState(title) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`${title}`);
    console.log(`${"=".repeat(80)}`);
    console.log(`总消息数: ${this.messages.length}`);
    console.log(`总 tokens: ${this.calculateTotalTokens()}`);
    console.log("\n消息列表:");
    
    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      let msgTokens = 0;
      if (msg.content) msgTokens += TokenEstimator.estimate(msg.content);
      
      let toolInfo = "";
      for (const part of msg.parts) {
        if (part.type === "tool") {
          const outputTokens = TokenEstimator.estimate(part.state.output);
          msgTokens += outputTokens;
          const compacted = part.state.time.compacted ? " [已压缩]" : "";
          toolInfo += ` [${part.tool}:${outputTokens}${compacted}]`;
        }
        if (part.type === "text") {
          msgTokens += TokenEstimator.estimate(part.text);
        }
      }
      
      const summaryTag = msg.summary ? " [SUMMARY]" : "";
      console.log(`  ${i + 1}. [${msg.role}]${summaryTag} ${msgTokens} tokens${toolInfo}`);
    }
  }

  printLogs() {
    console.log(`\n${"=".repeat(80)}`);
    console.log("操作日志");
    console.log(`${"=".repeat(80)}`);
    for (const log of this.logs) {
      console.log(log);
    }
  }
}

function generateLongToolOutput(length) {
  const words = ["the", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog", 
                 "function", "variable", "constant", "return", "if", "else", "for", "while",
                 "import", "export", "from", "as", "class", "interface", "type", "enum"];
  let output = "";
  for (let i = 0; i < length; i++) {
    output += words[Math.floor(Math.random() * words.length)] + " ";
    if (i % 20 === 0) output += "\n";
  }
  return output;
}

function generateVeryLongToolOutput(targetTokens) {
  let output = "";
  while (TokenEstimator.estimate(output) < targetTokens) {
    output += generateLongToolOutput(100) + "\n";
  }
  return output;
}

async function main() {
  console.log("\n");
  console.log("╔" + "═".repeat(78) + "╗");
  console.log("║" + " ".repeat(25) + "OpenCode 上下文管理示例" + " ".repeat(30) + "║");
  console.log("╚" + "═".repeat(78) + "╝");

  const compaction = new SessionCompaction();

  console.log("\n📝 步骤 1: 创建一个长对话");
  console.log("-".repeat(80));

  let msgId = 1;
  
  const user1 = new Message(msgId++, "user", "你好，我想了解 opencode 的上下文管理机制");
  user1.addTextPart("能给我详细讲讲剪枝和压缩吗？");
  compaction.addMessage(user1);

  const assistant1 = new Message(msgId++, "assistant", "好的！我来帮你搜索相关代码。");
  assistant1.addToolPart("grep", generateVeryLongToolOutput(15000), "completed");
  assistant1.addToolPart("read", generateVeryLongToolOutput(20000), "completed");
  compaction.addMessage(assistant1);

  const user2 = new Message(msgId++, "user", "很好！能给我看看具体的代码实现吗？");
  compaction.addMessage(user2);

  const assistant2 = new Message(msgId++, "assistant", "当然，让我读取更多文件。");
  assistant2.addToolPart("read", generateVeryLongToolOutput(25000), "completed");
  assistant2.addToolPart("glob", generateVeryLongToolOutput(8000), "completed");
  assistant2.addToolPart("grep", generateVeryLongToolOutput(18000), "completed");
  compaction.addMessage(assistant2);

  const user3 = new Message(msgId++, "user", "太棒了！能创建一个可运行的示例吗？");
  compaction.addMessage(user3);

  const assistant3 = new Message(msgId++, "assistant", "没问题，我来创建示例文件。");
  assistant3.addToolPart("write", generateLongToolOutput(600), "completed");
  assistant3.addToolPart("read", generateLongToolOutput(400), "completed");
  assistant3.addToolPart("bash", "npm install && npm run build", "completed");
  compaction.addMessage(assistant3);

  const user4 = new Message(msgId++, "user", "完美！现在能运行一下看看效果吗？");
  compaction.addMessage(user4);

  compaction.printState("初始状态（未压缩）");

  console.log("\n\n🔧 步骤 2: 执行剪枝");
  console.log("-".repeat(80));
  await new Promise(r => setTimeout(r, 500));
  compaction.prune();
  compaction.printState("剪枝后状态");

  console.log("\n\n🤖 步骤 3: 模拟压缩（用 AI 生成摘要）");
  console.log("-".repeat(80));
  await new Promise(r => setTimeout(r, 500));
  compaction.compact();
  compaction.printState("压缩后状态");

  console.log("\n\n📊 步骤 4: 最终对比");
  console.log("-".repeat(80));
  
  console.log("\n");
  compaction.printLogs();

  console.log("\n");
  console.log("✨ 完成！这个示例演示了 opencode 的核心上下文管理策略：");
  console.log("   1. 先尝试轻量级剪枝（删除旧工具输出）");
  console.log("   2. 如果还不够，再用 AI 生成对话摘要");
  console.log("\n");
}

main().catch(console.error);
