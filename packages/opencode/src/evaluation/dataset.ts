import z from "zod/v4"
import { Storage } from "../storage/storage"
import { Bus } from "../bus"

export namespace Dataset {
  /**
   * Assertion types for test cases
   */
  export const Assertion = z.discriminatedUnion("type", [
    z.object({
      type: z.literal("tool-called"),
      toolID: z.string(),
      minCount: z.number().optional(),
      maxCount: z.number().optional(),
    }),
    z.object({
      type: z.literal("output-matches"),
      pattern: z.string(), // Regex pattern
      flags: z.string().optional(),
    }),
    z.object({
      type: z.literal("output-contains"),
      substring: z.string(),
    }),
    z.object({
      type: z.literal("no-errors"),
    }),
    z.object({
      type: z.literal("duration-under"),
      milliseconds: z.number(),
    }),
    z.object({
      type: z.literal("cost-under"),
      dollars: z.number(),
    }),
    z.object({
      type: z.literal("metric-passes"),
      metricID: z.string(),
    }),
    z.object({
      type: z.literal("custom"),
      expression: z.string(), // JavaScript expression evaluated against trace
      description: z.string(),
    }),
  ])
  export type Assertion = z.infer<typeof Assertion>

  /**
   * Test case with input and expected behavior
   */
  export const TestCase = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    
    // Input
    input: z.object({
      prompt: z.string(),
      context: z.record(z.string(), z.any()).optional(),
    }),
    
    // Expected behavior
    assertions: z.array(Assertion),
    
    // Metadata
    tags: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
  })
  export type TestCase = z.infer<typeof TestCase>

  /**
   * Dataset definition
   */
  export const Definition = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    version: z.string(),
    
    testCases: z.array(TestCase),
    
    // Metadata
    tags: z.array(z.string()).default([]),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  export type Definition = z.infer<typeof Definition>

  export const Event = {
    Created: Bus.event(
      "dataset.created",
      z.object({
        datasetID: z.string(),
      }),
    ),
    Updated: Bus.event(
      "dataset.updated",
      z.object({
        datasetID: z.string(),
      }),
    ),
  }

  /**
   * Create a new dataset
   */
  export async function create(dataset: Omit<Definition, "createdAt" | "updatedAt">): Promise<Definition> {
    const now = Date.now()
    const complete: Definition = {
      ...dataset,
      createdAt: now,
      updatedAt: now,
    }
    
    await Storage.write(["dataset", dataset.id], complete)
    Bus.publish(Event.Created, { datasetID: dataset.id })
    return complete
  }

  /**
   * Update an existing dataset
   */
  export async function update(id: string, updates: Partial<Omit<Definition, "id" | "createdAt" | "updatedAt">>): Promise<Definition> {
    const existing = await get(id)
    const updated: Definition = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    }
    
    await Storage.write(["dataset", id], updated)
    Bus.publish(Event.Updated, { datasetID: id })
    return updated
  }

  /**
   * Get a dataset by ID
   */
  export async function get(id: string): Promise<Definition> {
    const dataset = await Storage.read<Definition>(["dataset", id])
    return dataset
  }

  /**
   * List all datasets
   */
  export async function list(): Promise<Definition[]> {
    const keys = await Storage.list(["dataset"])
    const datasets: Definition[] = []
    
    for (const key of keys) {
      const dataset = await Storage.read<Definition>(key)
      datasets.push(dataset)
    }
    
    return datasets.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Check if a dataset exists
   */
  export async function exists(id: string): Promise<boolean> {
    try {
      await get(id)
      return true
    } catch {
      return false
    }
  }

  /**
   * Remove a dataset
   */
  export async function remove(id: string): Promise<void> {
    await Storage.remove(["dataset", id])
  }

  /**
   * Find datasets by tag
   */
  export async function findByTag(tag: string): Promise<Definition[]> {
    const all = await list()
    return all.filter((d) => d.tags.includes(tag))
  }

  /**
   * Export dataset to JSON
   */
  export async function exportToJSON(id: string): Promise<string> {
    const dataset = await get(id)
    return JSON.stringify(dataset, null, 2)
  }

  /**
   * Import dataset from JSON
   */
  export async function importFromJSON(json: string): Promise<Definition> {
    const data = JSON.parse(json)
    const dataset = Definition.parse(data)
    
    // Check if exists and update, or create new
    if (await exists(dataset.id)) {
      return update(dataset.id, dataset)
    }
    return create(dataset)
  }

  /**
   * Add a test case to a dataset
   */
  export async function addTestCase(datasetID: string, testCase: TestCase): Promise<Definition> {
    const dataset = await get(datasetID)
    dataset.testCases.push(testCase)
    return update(datasetID, { testCases: dataset.testCases })
  }

  /**
   * Remove a test case from a dataset
   */
  export async function removeTestCase(datasetID: string, testCaseID: string): Promise<Definition> {
    const dataset = await get(datasetID)
    dataset.testCases = dataset.testCases.filter((tc) => tc.id !== testCaseID)
    return update(datasetID, { testCases: dataset.testCases })
  }

  /**
   * Get enabled test cases from a dataset
   */
  export async function getEnabledTestCases(datasetID: string): Promise<TestCase[]> {
    const dataset = await get(datasetID)
    return dataset.testCases.filter((tc) => tc.enabled)
  }
}
