export function getResponseMetadata({
  id,
  model,
  created,
}: {
  id?: string | undefined | null;
  created?: number | undefined | null;
  model?: string | undefined | null;
}) {
  return {
    id: id ?? undefined,
    modelId: model ?? undefined,
    timestamp: created != null ? new Date(created * 1000) : undefined,
  };
}
