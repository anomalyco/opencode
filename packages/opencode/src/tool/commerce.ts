import { Tool } from "./tool"
import { z } from "zod"
import { Commerce } from "../commerce"
import { CommerceGenerator } from "../commerce/generator"
import description from "./commerce.txt" with { type: "text" }

import { Instance } from "../project/instance"

export const CommerceTool = Tool.define("commerce", {
    description,
    parameters: z.object({
        action: z.enum(["marketplaces", "catalog", "performance"]),
        start: z.string().optional().describe("Start date for performance data (YYYY-MM-DD)"),
        end: z.string().optional().describe("End date for performance data (YYYY-MM-DD)"),
    }),
    execute: async ({ action, start, end }) => {

        if (action === "marketplaces") {
            const marketplaces = await Commerce.getMarketplaces()
            return JSON.stringify(marketplaces, null, 2)
        }

        if (action === "catalog") {
            let catalog = await Commerce.getCatalog()
            if (catalog.length === 0) {
                // Auto-seed if empty
                catalog = CommerceGenerator.mockProducts()
                await Commerce.saveCatalog(catalog)
            }
            return JSON.stringify(catalog, null, 2)
        }

        if (action === "performance") {
            // 1. Try to get existing performance data
            // Note: Commerce.getPerformance uses Instance.project.id internally

            let data = await Commerce.getPerformance({
                start: start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                end: end || new Date().toISOString()
            })

            // 2. If no data, generate it on the fly (Just-in-Time Synthetic Data)
            if (data.length === 0) {
                let catalog = await Commerce.getCatalog()
                if (catalog.length === 0) {
                    catalog = CommerceGenerator.mockProducts()
                    await Commerce.saveCatalog(catalog)
                }

                const marketplaces = await Commerce.getMarketplaces()
                const dataset = await CommerceGenerator.generate(catalog, marketplaces)

                // Save it so future queries work? 
                // For Phase 2, we just return the generated data as "Live Synthetic"
                // In a real app we would persist this.
                data = dataset.performance

                // Let's attach the economics to the output too for the agent to see
                return JSON.stringify({
                    performance: dataset.performance,
                    economics: dataset.economics,
                    note: "Data was synthetically generated because no historical records were found."
                }, null, 2)
            }

            return JSON.stringify(data, null, 2)
        }

        return "Invalid action"
    },
})
