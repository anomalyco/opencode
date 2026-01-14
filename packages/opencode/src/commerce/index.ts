import { Storage } from "../storage/storage"
import { Instance } from "../project/instance"
import { fn } from "@/util/fn"
import z from "zod"

export namespace Commerce {

    // 1. Data Source Types
    export const DataSourceType = z.enum(["storefront_mcp", "mock", "synthetic"])
    export type DataSourceType = z.infer<typeof DataSourceType>

    // 2. Marketplace Model
    export const MarketplaceID = z.enum(["amazon_in", "flipkart_in", "d2c_shopify"])
    export type MarketplaceID = z.infer<typeof MarketplaceID>

    export const MarketplaceConfig = z.object({
        id: MarketplaceID,
        name: z.string(),
        currency: z.string(),
        rules: z.object({
            commissionPct: z.number().default(0), // e.g. 0.15 for 15%
            fixedFee: z.number().default(0),      // e.g. 20 (INR)
            logisticsPerKg: z.number().default(0), // standard shipping
            taxPct: z.number().default(0)        // GST/VAT
        })
    })
    export type MarketplaceConfig = z.infer<typeof MarketplaceConfig>

    // 3. Product Catalog (Ground Truth)
    export const Product = z.object({
        id: z.string(),
        sku: z.string(),
        title: z.string(),
        price: z.number(),
        weightKg: z.number().default(0.5),
        variants: z.array(z.string()).default([]),
        source: z.literal("storefront_mcp").or(z.literal("mock")),
        policies: z.record(z.string(), z.any()).optional()
    })
    export type Product = z.infer<typeof Product>

    // 4. Time Series Data (Synthetic/Real)
    export const Period = z.enum(["day", "week", "month"])
    export type Period = z.infer<typeof Period>

    export const PerformanceRecord = z.object({
        productID: z.string(),
        marketplace: MarketplaceID,
        date: z.string(), // ISO Date YYYY-MM-DD
        period: Period,

        // Metrics
        unitsSold: z.number(),
        revenue: z.number(),
        adSpend: z.number(),
        returns: z.number(),

        // Quality Metadata
        dataSource: DataSourceType,
        generatedAt: z.number()
    })
    export type PerformanceRecord = z.infer<typeof PerformanceRecord>

    // 5. Product Economics (Calculated)
    export const UnitEconomics = z.object({
        productID: z.string(),
        marketplace: MarketplaceID,
        sellingPrice: z.number(),

        // Costs
        commission: z.number(),
        logistics: z.number(),
        tax: z.number(),
        marketingCAC: z.number(),
        returnCost: z.number(),

        // Net
        netContribution: z.number(), // Profit per unit
        marginPct: z.number()
    })
    export type UnitEconomics = z.infer<typeof UnitEconomics>

    // Aggregate Data Object
    export const Dataset = z.object({
        timestamp: z.number(),
        products: z.array(Product),
        performance: z.array(PerformanceRecord),
        economics: z.array(UnitEconomics)
    })
    export type Dataset = z.infer<typeof Dataset>

    // --- API ---

    export const getMarketplaces = fn(z.void(), async () => {
        // Hardcoded Marketplace Definitions for Phase 2
        return [
            {
                id: "amazon_in",
                name: "Amazon India",
                currency: "INR",
                rules: { commissionPct: 0.18, fixedFee: 25, logisticsPerKg: 65, taxPct: 0.18 }
            },
            {
                id: "flipkart_in",
                name: "Flipkart",
                currency: "INR",
                rules: { commissionPct: 0.15, fixedFee: 15, logisticsPerKg: 55, taxPct: 0.18 }
            },
            {
                id: "d2c_shopify",
                name: "Official Store",
                currency: "INR",
                rules: { commissionPct: 0.02, fixedFee: 0, logisticsPerKg: 80, taxPct: 0.18 } // Payment gateway fee only
            }
        ] as MarketplaceConfig[]
    })

    export const getCatalog = fn(z.void(), async () => {
        const projectID = Instance.project.id
        // TODO: Connect to real MCP. For now returning null/empty to force synthetic generation logic later
        return await Storage.read<Product[]>(["commerce", projectID, "catalog"]).catch(() => [])
    })

    export const saveCatalog = fn(z.array(Product), async (products) => {
        const projectID = Instance.project.id
        await Storage.write(["commerce", projectID, "catalog"], products)
    })

    export const getPerformance = fn(z.object({
        start: z.string(),
        end: z.string()
    }), async (range) => {
        const projectID = Instance.project.id
        // Simple filter can be added here
        return await Storage.read<PerformanceRecord[]>(["commerce", projectID, "performance"]).catch(() => [])
    })

}
