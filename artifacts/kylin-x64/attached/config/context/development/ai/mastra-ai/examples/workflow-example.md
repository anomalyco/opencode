<!-- Context: development/workflow-example | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Example: Document Ingestion Workflow

**Purpose**: Demonstrates a multi-step workflow with parallel processing.

**Last Updated**: 2026-01-09

---

## Workflow Definition
```typescript
export const documentIngestionWorkflow = createWorkflow({
  id: 'document-ingestion',
  inputSchema: z.object({ filename: z.string(), fileBuffer: z.any() }),
  outputSchema: z.object({ documentId: z.string(), success: z.boolean() }),
})
  .then(uploadStep)      // Step 1: Upload
  .then(extractionStep)  // Step 2: Extract Text
  .parallel([            // Step 3: Process in parallel
    classificationStep,
    summarizationStep
  ])
  .then(mergeResultsStep) // Step 4: Merge
  .commit();
```

## Step Execution
```typescript
const uploadStep = createStep({
  id: 'upload-document',
  execute: async ({ inputData, mastra }) => {
    const result = await documentUploadTool.execute(inputData, { mastra });
    return result;
  },
});
```

**Reference**: `src/mastra/workflows/document-ingestion-with-classification-workflow.ts`
**Related**:
- concepts/workflows.md
- concepts/agents-tools.md
