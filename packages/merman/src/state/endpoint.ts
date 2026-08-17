export function stateDiagramStartMarkerId(scope?: string): string {
  return scope ? `${scope}.__start` : "__start"
}

export function stateDiagramEndMarkerId(scope?: string): string {
  return scope ? `${scope}.__end` : "__end"
}

export function stateDiagramMarkerId(position: "from" | "to", scope?: string): string {
  return position === "from" ? stateDiagramStartMarkerId(scope) : stateDiagramEndMarkerId(scope)
}

export function normalizeStateDiagramEndpoint(value: string, position: "from" | "to", scope?: string): string {
  return value === "[*]" ? stateDiagramMarkerId(position, scope) : value
}
