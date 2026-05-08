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

  const occurrences = matches
    .map((m) =>
      m.index === undefined ? undefined : { tag: m[0], originalIndex: m.index },
    )
    .filter((m): m is { tag: string; originalIndex: number } => m !== undefined);

  const known = new Set(
    opts.currentParts
      .flatMap((p) => {
        if (p.type === "file" && p.source?.text?.value != null) {
          return [p.source.text.value];
        }
        if (p.type === "agent" && p.source?.value != null) {
          return [p.source.value];
        }
        return [];
      })
      .filter((v) => opts.content.includes(v)),
  );
  const unknowns = [
    ...new Set(occurrences.map((m) => m.tag).filter((t) => !known.has(t))),
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

  type Replacement = {
    originalIndex: number;
    oldLen: number;
    newText: string;
    filePath: string;
  };

  const finalizeParts = (content: string, replacements: Replacement[]) =>
    parts.map((part) => {
      if (part.type !== "agent" || !part.source) return part;

      const source = part.source;
      const shift = replacements
        .filter((r) => r.originalIndex < source.start)
        .reduce((sum, r) => sum + r.newText.length - r.oldLen, 0);
      const finalIndex = source.start + shift;
      const finalStart = Bun.stringWidth(content.slice(0, finalIndex));

      return {
        type: "agent" as const,
        name: part.name,
        source: {
          start: finalStart,
          end: finalStart + Bun.stringWidth(source.value),
          value: source.value,
        },
      };
    });

  // Agent parts — positions stay relative to original content
  for (const tag of agentTags) {
    for (const occurrence of occurrences.filter((m) => m.tag === tag)) {
      parts.push({
        type: "agent",
        name: tag.slice(1),
        source: {
          start: occurrence.originalIndex,
          end: occurrence.originalIndex + tag.length,
          value: tag,
        },
      });
    }
  }

  if (fileTagItems.length === 0) {
    return { content: opts.content, parts: finalizeParts(opts.content, []) };
  }

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

  // Collect replacements with original positions
  const replacements: Replacement[] = [];
  for (const item of resolved) {
    const filePath = item.filePath;
    if (!filePath) continue;

    replacements.push(
      ...occurrences
        .filter((m) => m.tag === item.tag)
        .map((occurrence) => ({
          originalIndex: occurrence.originalIndex,
          oldLen: item.tag.length,
          newText: "@" + filePath,
          filePath,
        })),
    );
  }

  if (replacements.length === 0) {
    return { content: opts.content, parts: finalizeParts(opts.content, []) };
  }

  // Apply replacements to content right-to-left
  const sortedByPosDesc = [...replacements].sort(
    (a, b) => b.originalIndex - a.originalIndex,
  );
  const content = sortedByPosDesc.reduce(
    (acc, r) =>
      acc.slice(0, r.originalIndex) +
      r.newText +
      acc.slice(r.originalIndex + r.oldLen),
    opts.content,
  );

  // Compute final positions via cumulative shift
  // Sort replacements by originalIndex ASC to compute cumulative shift up to any point
  const sortedByPosAsc = [...replacements].sort(
    (a, b) => a.originalIndex - b.originalIndex,
  );
  const baseDir = opts.directory.replace(/\/+$/, "");

  for (const r of sortedByPosAsc) {
    // Cumulative shift from all replacements BEFORE this one
    const shift = sortedByPosAsc
      .filter((prev) => prev.originalIndex < r.originalIndex)
      .reduce((sum, prev) => sum + prev.newText.length - prev.oldLen, 0);
    const finalIndex = r.originalIndex + shift;
    const finalStart = Bun.stringWidth(content.slice(0, finalIndex));
    const finalEnd = finalStart + Bun.stringWidth(r.newText);

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

  return { content, parts: finalizeParts(content, sortedByPosAsc) };
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
