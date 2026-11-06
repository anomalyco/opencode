export * as SessionShellBatch from "./shell-batch.js"

import { Message, SystemPart } from "@opencode/ai/effect"

export const prompt = `可能な限り shell を使ってタスクを実行してください。

独立した操作は、1回の shell ツール呼び出しにまとめてください。
後続の操作をシェル内で判断できる場合は、同じ shell ツール呼び出しの中で続けてください。

1回にまとめる操作数に小さな上限はありません。例えば、30個以上の操作を含む長い呼び出しも可能です。

command1; command2; command3; command4; command5;
command6; command7; command8; command9; command10;
command11; command12; command13; command14; command15;
command16; command17; command18; command19; command20;
command21; command22; command23; command24; command25;
command26; command27; command28; command29; command30

シェルや Python で条件分岐を使い、同じ呼び出し内でシェルコマンドと Python を組み合わせることもできます。そのような呼び出しにも30個以上の操作を含められます。例えば：

command1; command2; command3; command4; command5;
command6; command7; command8; command9; command10;
if shell_condition; then
  command11; command12; command13; command14; command15;
else
  command16; command17; command18; command19; command20;
fi
python3 - <<'PYTHON'
if python_condition:
    python_operation1()
    python_operation2()
else:
    python_operation3()
    python_operation4()
PYTHON
command21; command22; command23; command24; command25;
command26; command27; command28; command29; command30

上記のコマンド名、条件、Python の操作は例示用のプレースホルダーであり、実際のコマンドやコードではありません。`

const reminder = `<system-reminder>\nリマインドです。このリマインドには返答せず、作業を続けてください。\n\n${prompt}\n</system-reminder>`

export function prepare(transcript: { system: Array<SystemPart>; messages: Array<Message> }, enabled: boolean) {
  if (!enabled) return transcript
  const system = [...transcript.system, SystemPart.make(prompt)]
  const pending = new Set<string>()
  const messages: Message[] = []
  let firstUser = true
  let count = 0
  let reminded = 0
  for (const message of transcript.messages) {
    const first = firstUser && message.role === "user"
    if (first) firstUser = false
    messages.push(first ? Message.make({ ...message, content: [...message.content, Message.text(prompt)] }) : message)
    for (const part of message.content) {
      if (message.role === "assistant" && part.type === "tool-call" && part.providerExecuted !== true)
        pending.add(part.id)
      if (message.role === "tool" && part.type === "tool-result") {
        pending.delete(part.id)
        if (part.name === "shell") count++
      }
    }
    if (pending.size === 0 && Math.floor(count / 10) > reminded) {
      messages.push(Message.system(reminder))
      reminded = Math.floor(count / 10)
    }
  }
  return { system, messages }
}
