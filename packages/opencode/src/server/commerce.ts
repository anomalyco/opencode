import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Commerce } from "../commerce"
import { CommerceGenerator } from "../commerce/generator"
import { z } from "zod"

export const CommerceRoute = new Hono()

CommerceRoute.get(
    "/marketplaces",
    describeRoute({
        summary: "Get Marketplaces",
        description: "Get the definitions of all supported marketplaces.",
        operationId: "commerce.marketplaces",
        responses: {
            200: { description: "List of Marketplaces", content: { "application/json": { schema: resolver(z.array(Commerce.MarketplaceConfig)) } } }
        }
    }),
    async (c) => {
        return c.json(await Commerce.getMarketplaces())
    }
)

CommerceRoute.get(
    "/catalog",
    describeRoute({
        summary: "Get Product Catalog",
        description: "Get the current ground-truth product catalog.",
        operationId: "commerce.catalog",
        responses: {
            200: { description: "Product Catalog", content: { "application/json": { schema: resolver(z.array(Commerce.Product)) } } }
        }
    }),
    async (c) => {
        let catalog = await Commerce.getCatalog()
        if (catalog.length === 0) {
            // Fallback to mock for Phase 2 if empty
            catalog = CommerceGenerator.mockProducts()
            await Commerce.saveCatalog(catalog)
        }
        return c.json(catalog)
    }
)

CommerceRoute.post(
    "/generate",
    describeRoute({
        summary: "Generate Synthetic Data",
        description: "Generate a fresh set of synthetic performance data.",
        operationId: "commerce.generate",
        responses: {
            200: { description: "Full Dataset", content: { "application/json": { schema: resolver(Commerce.Dataset) } } }
        }
    }),
    async (c) => {
        let catalog = await Commerce.getCatalog()
        if (catalog.length === 0) catalog = CommerceGenerator.mockProducts()

        const marketplaces = await Commerce.getMarketplaces()
        const dataset = await CommerceGenerator.generate(catalog, marketplaces)

        // In a real app we'd save this to a huge db. For Phase 2 we just return the snapshot or store it lightly.
        // We'll store it in a 'latest' key for retrieval
        // await Commerce.saveDataset(dataset) // Assuming implementation

        return c.json(dataset)
    }
)
