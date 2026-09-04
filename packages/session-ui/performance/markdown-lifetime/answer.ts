export function completedAnswer(sections: number) {
  return `# Recovery implementation review\n\n${Array.from({ length: sections }, (_, index) => {
    const service = ["catalog", "billing", "delivery", "inventory", "accounts", "notifications"][index % 6]
    return [
      `## ${index + 1}. Validate the ${service} recovery boundary`,
      `The ${service} service should publish durable progress before acknowledging a request. Keep the request ID in the transaction so a retry does not create a second operation. The implementation below separates admission from delivery and makes the recovery decision explicit.`,
      "Check the existing rows before scheduling work. A disconnected client is not evidence that the operation failed, and the background processor must not delete accepted work when a view closes. Use the stored status for the next attempt, not a process-local flag.",
      `\`\`\`typescript\nexport async function recover${index}(db: Database, request: Request) {\n  const previous = await db.operations.find(request.id)\n  if (previous?.status === "complete") return previous.result\n  const operation = previous ?? await db.transaction(async (tx) => {\n    const row = await tx.operations.insert({\n      id: request.id,\n      service: "${service}",\n      status: "accepted",\n      payload: request.payload,\n    })\n    await tx.events.publish({ type: "operation.accepted", id: row.id })\n    return row\n  })\n  await schedule(operation.id)\n  return { id: operation.id, status: operation.status }\n}\n\`\`\``,
      "| Condition | Expected behavior |\n| --- | --- |\n| Duplicate request | Return the first accepted result |\n| Worker restart | Resume the stored operation |\n| Client leaves | Retain accepted work without retaining the view |",
      `Run the focused test with \`bun test test/${service}/recovery.test.ts\`. Verify the [transaction contract](https://example.com/transactions) and inspect the operation's final state before expanding the rollout.`,
    ].join("\n\n")
  }).join("\n\n")}\n\n**Review complete.**`
}
