/*
 * rewriter.ts - turns a finding (or two) into a rewritten prompt, not just an
 * appended sentence. This is the "Fix my prompt" action.
 *
 * It keeps the developer's original intent and injects the specific fix at the
 * right place, so the next send is correct by construction instead of "fixed +
 * extra paragraph tacked on."
 */

import type { Finding } from "./triage";

export function rewritePrompt(original: string, findings: Finding[]): string {
  if (!findings.length) {
    return original;
  }
  const t = original.trim().replace(/\.+$/, "");

  const parts = [`Rewrite this request so the result is safe and correct.`];
  for (const f of findings) {
    parts.push(`- ${f.fix}`);
  }
  parts.push(`Keep the rest of the intent: "${t}".`);

  return parts.join("\n") + "\n";
}
