import { Commerce } from "./index"
import { z } from "zod"
import { iife } from "@/util/iife"

export namespace CommerceGenerator {

    // Seedable random number generator for deterministic "Simulated Reality"
    class SeededRandom {
        private seed: number;
        constructor(seed: number) { this.seed = seed }

        // Simple LCG
        next(): number {
            this.seed = (this.seed * 9301 + 49297) % 233280;
            return this.seed / 233280;
        }

        range(min: number, max: number): number {
            return Math.floor(this.next() * (max - min + 1) + min)
        }
    }

    export const generate = async (
        products: Commerce.Product[],
        marketplaces: Commerce.MarketplaceConfig[],
        days: number = 30
    ): Promise<Commerce.Dataset> => {

        const now = new Date()
        const performance: Commerce.PerformanceRecord[] = []
        const economics: Commerce.UnitEconomics[] = []
        const rng = new SeededRandom(12345) // Fixed seed for reproducibility

        // 1. Generate Daily Performance
        for (let i = 0; i < days; i++) {
            const date = new Date(now)
            date.setDate(date.getDate() - i)
            const dateStr = date.toISOString().split('T')[0]

            for (const product of products) {
                for (const market of marketplaces) {
                    // Determine base "velocity" of product on market
                    // Amazon > Flipkart > D2C usually for velocity, but D2C higher margin
                    let velocityMultiplier = 1
                    if (market.id === 'amazon_in') velocityMultiplier = 2.5
                    if (market.id === 'flipkart_in') velocityMultiplier = 1.8

                    const unitsSold = rng.range(0, 10 * velocityMultiplier)
                    const returns = Math.floor(unitsSold * (rng.range(5, 15) / 100)) // 5-15% return rate

                    // Ad Spend fluctuates
                    const adSpend = rng.range(500, 2000)

                    performance.push({
                        productID: product.id,
                        marketplace: market.id,
                        date: dateStr,
                        period: "day",
                        unitsSold,
                        revenue: unitsSold * product.price,
                        adSpend,
                        returns,
                        dataSource: "synthetic",
                        generatedAt: Date.now()
                    })
                }
            }
        }

        // 2. Calculate Economics (Static View per Product/Market)
        for (const product of products) {
            for (const market of marketplaces) {
                const rules = market.rules

                const commission = product.price * rules.commissionPct
                const fixed = rules.fixedFee
                const logistics = product.weightKg * rules.logisticsPerKg
                // Tax mainly on Price (simplification)
                const tax = product.price * rules.taxPct

                // Marketing CAC (Simulated avg from performance)
                // In a real engine, this would aggregation. Here we estimate.
                const marketingCAC = product.id.includes("premium") ? 400 : 150
                const returnCost = 100 // Flat simulation

                const totalCost = commission + fixed + logistics + tax + marketingCAC + (returnCost * 0.1) // Assumed 10% rtr rate
                const net = product.price - totalCost

                economics.push({
                    productID: product.id,
                    marketplace: market.id,
                    sellingPrice: product.price,
                    commission,
                    logistics,
                    tax,
                    marketingCAC,
                    returnCost,
                    netContribution: net,
                    marginPct: Math.round((net / product.price) * 100)
                })
            }
        }

        return {
            timestamp: Date.now(),
            products,
            performance,
            economics
        }
    }

    // Helper to create Mock Products if Catalog is empty
    export const mockProducts = (): Commerce.Product[] => [
        { id: "p_run_v1", sku: "NIKE-PEG-40", title: "Nike Air Zoom Pegasus 40", price: 11999, weightKg: 0.8, source: "mock", variants: [] },
        { id: "p_run_v2", sku: "ADIDAS-UB-L", title: "Adidas Ultraboost Light", price: 16999, weightKg: 0.7, source: "mock", variants: [] },
        { id: "p_trail_x", sku: "SAL-SPEED-5", title: "Salomon Speedcross 5", price: 12999, weightKg: 1.1, source: "mock", variants: [] }
    ]
}
