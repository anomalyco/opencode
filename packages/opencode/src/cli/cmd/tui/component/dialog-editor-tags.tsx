import { createMemo, createResource, createSignal } from "solid-js";
import { DialogSelect } from "@tui/ui/dialog-select";
import { useDialog, type DialogContext } from "@tui/ui/dialog";
import { useSDK } from "@tui/context/sdk";
import { FILE_REGEX } from "@/config/markdown";
import path from "path";
import { pathToFileURL } from "url";
import type { PromptInfo } from "./prompt/history";

export async function resolveEditorTags(opts: {
  content: string;
  currentParts: PromptInfo["parts"];
  directory: string;
  dialog: DialogContext;
  agentNames: string[];
}): Promise<{
  content: string;
  parts: PromptInfo["parts"];
}> {
  const matches = Array.from(opts.content.matchAll(FILE_REGEX));
  if (matches.length === 0) return { content: opts.content, parts: [] };

  const known = new Set(
    opts.currentParts
      .filter(
        (
          p,
        ): p is PromptInfo["parts"][number] & {
          source: { text: { value: string } };
        } => p.type === "file" && p.source?.text?.value != null,
      )
      .map((p) => p.source.text.value)
      .filter((v) => opts.content.includes(v)),
  );
  const unknowns = [
    ...new Set(matches.map((m) => m[0]).filter((t) => !known.has(t))),
  ];
  if (unknowns.length === 0) return { content: opts.content, parts: [] };

  const agentTags: string[] = [];
  const fileTagItems: { tag: string; name: string }[] = [];
  for (const tag of unknowns) {
    const name = tag.slice(1);
    if (opts.agentNames.includes(name)) agentTags.push(tag);
    else fileTagItems.push({ tag, name });
  }

  const parts: PromptInfo["parts"] = [];

  // Agent parts — positions stay relative to original content
  for (const tag of agentTags) {
    const pos = opts.content.indexOf(tag);
    if (pos === -1) continue;
    parts.push({
      type: "agent",
      name: tag.slice(1),
      source: { start: pos, end: pos + tag.length, value: tag },
    });
  }

  if (fileTagItems.length === 0) return { content: opts.content, parts };

  // Show dialog and resolve each file tag to a real file path
  const resolvedRef: { current: { tag: string; filePath: string | null }[] } = {
    current: [],
  };
  const resolved = await new Promise<
    { tag: string; filePath: string | null }[]
  >((resolve) => {
    opts.dialog.replace(
      () => (
        <TagFlow
          tags={fileTagItems.map((x) => x.tag)}
          resolvedRef={resolvedRef}
        />
      ),
      () => resolve(resolvedRef.current),
    );
  });

  type Replacement = {
    originalPos: number;
    oldLen: number;
    newText: string;
    filePath: string;
  };

  // Collect replacements with original positions
  const replacements: Replacement[] = [];
  for (const item of resolved) {
    if (!item.filePath) continue;

    const pos = opts.content.indexOf(item.tag);
    if (pos === -1) continue;

    replacements.push({
      originalPos: pos,
      oldLen: item.tag.length,
      newText: "@" + item.filePath,
      filePath: item.filePath,
    });
  }

  if (replacements.length === 0) return { content: opts.content, parts };

  // Apply replacements to content right-to-left
  const sortedByPosDesc = [...replacements].sort(
    (a, b) => b.originalPos - a.originalPos,
  );
  let content = opts.content;
  for (const r of sortedByPosDesc) {
    content =
      content.slice(0, r.originalPos) +
      r.newText +
      content.slice(r.originalPos + r.oldLen);
  }

  // Compute final positions via cumulative shift
  // Sort replacements by originalPos ASC to compute cumulative shift up to any point
  const sortedByPosAsc = [...replacements].sort(
    (a, b) => a.originalPos - b.originalPos,
  );
  const baseDir = opts.directory.replace(/\/+$/, "");

  for (const r of sortedByPosAsc) {
    // Cumulative shift from all replacements BEFORE this one
    let shift = 0;
    for (const prev of sortedByPosAsc) {
      if (prev.originalPos >= r.originalPos) break;
      shift += prev.newText.length - prev.oldLen;
    }

    const finalStart = r.originalPos + shift;
    const finalEnd = finalStart + r.newText.length;

    const fullPath = path.isAbsolute(r.filePath)
      ? r.filePath
      : path.join(baseDir, r.filePath);
    const urlObj = pathToFileURL(fullPath);

    parts.push({
      type: "file",
      mime: "text/plain",
      filename: r.filePath,
      url: urlObj.href,
      source: {
        type: "file",
        text: { start: finalStart, end: finalEnd, value: r.newText },
        path: r.filePath,
      },
    });
  }

  // Recompute agent part positions in the final content by applying cumulative shift
  const finalAgentParts: PromptInfo["parts"] = [];
  for (const part of parts) {
    if (part.type !== "agent" || !part.source) {
      finalAgentParts.push(part);
      continue;
    }

    const s = part.source;
    let shift = 0;
    for (const r of sortedByPosAsc) {
      if (r.originalPos >= s.start) break;
      shift += r.newText.length - r.oldLen;
    }

    finalAgentParts.push({
      type: "agent",
      name: part.name,
      source: {
        start: s.start + shift,
        end: s.start + shift + s.value.length,
        value: s.value,
      },
    });
  }

  return { content, parts: finalAgentParts };
}

function TagFlow(props: {
  tags: string[];
  resolvedRef: { current: { tag: string; filePath: string | null }[] };
}) {
  const dialog = useDialog();
  const sdk = useSDK();
  const [idx, setIdx] = createSignal(0);
  const [filter, setFilter] = createSignal(props.tags[0]?.slice(1) ?? "");

  const [files] = createResource(
    () => filter(),
    async (q) => {
      if (!q) return [];
      const result = await sdk.client.find
        .files({ query: q })
        .catch(() => ({ error: true, data: undefined }));
      if (result.error) return [];
      return (result.data ?? []).slice(0, 5);
    },
  );

  const options = createMemo(() =>
    (files() ?? []).map((f: string) => ({
      value: f,
      title: f,
    })),
  );

  function advance(filePath: string) {
    const newResolved = [
      ...props.resolvedRef.current,
      { tag: props.tags[idx()], filePath },
    ];
    props.resolvedRef.current = newResolved;
    const next = idx() + 1;
    if (next >= props.tags.length) {
      dialog.clear();
      return;
    }
    setIdx(next);
    setFilter(props.tags[next].slice(1));
  }

  return (
    <DialogSelect
      title={`Resolve ${props.tags[idx()]} (${idx() + 1}/${props.tags.length})    ^S:skip escape:skip all`}
      placeholder="Search for a file..."
      options={options()}
      skipFilter={true}
      onFilter={(q) => setFilter(q)}
      onSelect={(option) => advance(option.value)}
      bindings={[{ key: "ctrl+s", cmd: () => advance("") }]}
    />
  );
}
