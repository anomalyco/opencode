import z from "zod"
import { Tool } from "../tool/tool"
import { BrowserService } from "./index"

export const BrowserSetGeolocationTool = Tool.define("browser_setGeolocation", {
  description: "Set the browser's geolocation",
  parameters: z.object({
    latitude: z.number().describe("Latitude (-90 to 90)"),
    longitude: z.number().describe("Longitude (-180 to 180)"),
    accuracy: z.number().optional().default(100).describe("Accuracy in meters"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        action: "set_geolocation",
        latitude: params.latitude,
        longitude: params.longitude,
      },
    })

    await BrowserService.setGeolocation(params.latitude, params.longitude, params.accuracy)

    return {
      title: `Geolocation set`,
      output: `Location: ${params.latitude}, ${params.longitude} (±${params.accuracy}m)`,
      metadata: {
        latitude: params.latitude,
        longitude: params.longitude,
        accuracy: params.accuracy,
      },
    }
  },
})
