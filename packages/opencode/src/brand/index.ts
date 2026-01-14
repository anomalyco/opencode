import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Storage } from "../storage/storage"
import { Instance } from "../project/instance"
import { fn } from "@/util/fn"
import { Log } from "../util/log"

export namespace Brand {
    const log = Log.create({ service: "brand" })

    export const AssetType = z.enum(["logo", "product", "creative", "guideline", "other"])
    export type AssetType = z.infer<typeof AssetType>

    export const Asset = z.object({
        id: z.string(),
        filename: z.string(),
        path: z.string(), // Local path to stored file
        type: AssetType,
        metadata: z.record(z.string(), z.any()).optional(),
        analysis: z.object({
            colors: z.array(z.string()).optional(),
            extractedText: z.string().optional(),
            description: z.string().optional(),
        }).optional(),
        uploadedAt: z.number(),
    })
    export type Asset = z.infer<typeof Asset>

    export const Tone = z.string()
    export const Color = z.string() // Hex code

    export const Context = z.object({
        id: z.string(),
        projectID: z.string(),
        name: z.string().optional(),
        tone: z.array(Tone).default([]),
        primaryColors: z.array(Color).default([]),
        visualPatterns: z.array(z.string()).default([]),
        assets: z.array(Asset).default([]),
        doNotUse: z.array(z.string()).default([]), // List of asset IDs or filenames
        status: z.enum(["pending", "processing", "ready", "approved"]).default("pending"),
        version: z.number().default(1),
        time: z.object({
            created: z.number(),
            updated: z.number(),
            approved: z.number().optional()
        })
    })
    export type Context = z.infer<typeof Context>

    export const Event = {
        Updated: BusEvent.define(
            "brand.updated",
            z.object({
                context: Context,
            }),
        ),
    }

    export const get = fn(z.void(), async () => {
        const projectID = Instance.project.id
        // We assume 1 brand per project for now, keyed by projectID
        const context = await Storage.read<Context>(["brand", projectID]).catch(() => null)
        return context
    })

    export const create = fn(z.object({ name: z.string().optional() }), async (input) => {
        const projectID = Instance.project.id
        const context: Context = {
            id: crypto.randomUUID(),
            projectID,
            name: input.name,
            tone: [],
            primaryColors: [],
            visualPatterns: [],
            assets: [],
            doNotUse: [],
            status: "pending",
            version: 1,
            time: {
                created: Date.now(),
                updated: Date.now()
            }
        }
        await Storage.write(["brand", projectID], context)
        return context
    })

    export const addAsset = fn(
        z.object({
            filename: z.string(),
            path: z.string(),
            type: AssetType
        }),
        async (input) => {
            const projectID = Instance.project.id
            let context = await get()
            if (!context) {
                context = await create({})
            }

            const asset: Asset = {
                id: crypto.randomUUID(),
                filename: input.filename,
                path: input.path,
                type: input.type,
                uploadedAt: Date.now(),
                analysis: {}
            }

            // TODO: Trigger analysis pipeline here (async)
            analyzeAsset(asset)

            context.assets.push(asset)
            await update(context)
            return context
        })

    export const update = fn(Context, async (context) => {
        const projectID = Instance.project.id
        context.time.updated = Date.now()
        context.version += 1
        await Storage.write(["brand", projectID], context)
        // Publish event
        return context
    })

    // Stub for analysis
    async function analyzeAsset(asset: Asset) {
        log.info(`Analyzing asset: ${asset.filename}`)
        // In a real implementation, this would call a Vision model
        // For now, we just pass through
    }

    export const approve = fn(z.void(), async () => {
        const context = await get()
        if (!context) throw new Error("No brand context found")

        context.status = "approved"
        context.time.approved = Date.now()
        await update(context)
        return context
    })
}
