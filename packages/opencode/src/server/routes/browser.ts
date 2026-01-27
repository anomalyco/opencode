import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Browser } from "../../browser/browser"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const BrowserRoutes = lazy(() =>
  new Hono()
    .post(
      "/navigate",
      describeRoute({
        summary: "Navigate to URL",
        description: "Navigate the browser to a specified URL.",
        operationId: "browser.navigate",
        responses: {
          200: {
            description: "Navigation result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    data: z.any().optional(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          url: z.string().min(1).describe("The URL to navigate to"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.navigate(options)
        return c.json(result)
      },
    )
    .post(
      "/screenshot",
      describeRoute({
        summary: "Take screenshot",
        description: "Capture a screenshot of the current page.",
        operationId: "browser.screenshot",
        responses: {
          200: {
            description: "Screenshot result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    data: z.any().optional(),
                    screenshot: z.string().optional(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          fullPage: z.boolean().optional().describe("Whether to capture the full page"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.screenshot(options)
        return c.json(result)
      },
    )
    .post(
      "/click",
      describeRoute({
        summary: "Click element",
        description: "Click on an element matching the selector.",
        operationId: "browser.click",
        responses: {
          200: {
            description: "Click result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          selector: z.string().describe("CSS selector for the element to click"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.click(options)
        return c.json(result)
      },
    )
    .post(
      "/type",
      describeRoute({
        summary: "Type text",
        description: "Type text into an element matching the selector.",
        operationId: "browser.type",
        responses: {
          200: {
            description: "Type result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          selector: z.string().describe("CSS selector for the element"),
          text: z.string().describe("Text to type"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.type(options)
        return c.json(result)
      },
    )
    .post(
      "/scroll",
      describeRoute({
        summary: "Scroll page",
        description: "Scroll the page in the specified direction.",
        operationId: "browser.scroll",
        responses: {
          200: {
            description: "Scroll result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
          amount: z.number().optional().describe("Amount to scroll in pixels"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.scroll(options)
        return c.json(result)
      },
    )
    .post(
      "/extract",
      describeRoute({
        summary: "Extract content",
        description: "Extract content from the page or from specific elements.",
        operationId: "browser.extract",
        responses: {
          200: {
            description: "Extraction result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    content: z.string().optional(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          selector: z.string().optional().describe("CSS selector to extract content from"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.extractContent(options)
        return c.json(result)
      },
    )
    .post(
      "/execute",
      describeRoute({
        summary: "Execute script",
        description: "Execute JavaScript code in the browser context.",
        operationId: "browser.execute",
        responses: {
          200: {
            description: "Execution result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    data: z.any().optional(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          script: z.string().describe("JavaScript code to execute"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.executeScript(options)
        return c.json(result)
      },
    )
    .get(
      "/title",
      describeRoute({
        summary: "Get page title",
        description: "Get the title of the current page.",
        operationId: "browser.getTitle",
        responses: {
          200: {
            description: "Page title",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    data: z.string().optional(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await Browser.getTitle()
        return c.json(result)
      },
    )
    .get(
      "/url",
      describeRoute({
        summary: "Get current URL",
        description: "Get the URL of the current page.",
        operationId: "browser.getURL",
        responses: {
          200: {
            description: "Current URL",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    data: z.string().optional(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await Browser.getURL()
        return c.json(result)
      },
    )
    .get(
      "/content",
      describeRoute({
        summary: "Get page content",
        description: "Get the HTML content of the current page.",
        operationId: "browser.getContent",
        responses: {
          200: {
            description: "Page content",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    data: z.string().optional(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await Browser.getContent()
        return c.json(result)
      },
    )
    .post(
      "/query",
      describeRoute({
        summary: "Query selector",
        description: "Query elements using CSS selector.",
        operationId: "browser.query",
        responses: {
          200: {
            description: "Query result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    data: z.array(z.any()).optional(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          query: z.string().describe("CSS query selector"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.querySelector(options)
        return c.json(result)
      },
    )
    .post(
      "/wait",
      describeRoute({
        summary: "Wait for selector",
        description: "Wait for an element matching the selector to appear.",
        operationId: "browser.wait",
        responses: {
          200: {
            description: "Wait result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          selector: z.string().describe("CSS selector to wait for"),
          timeout: z.number().optional().describe("Timeout in milliseconds"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.waitForSelector({
          selector: options.selector,
          timeout: options.timeout ?? 5000,
        })
        return c.json(result)
      },
    )
    .post(
      "/evaluate",
      describeRoute({
        summary: "Evaluate JavaScript",
        description: "Evaluate JavaScript code in the browser context.",
        operationId: "browser.evaluate",
        responses: {
          200: {
            description: "Evaluation result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    data: z.any().optional(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          code: z.string().describe("JavaScript code to evaluate"),
        }),
      ),
      async (c) => {
        const options = c.req.valid("json")
        const result = await Browser.evaluateJavaScript(options)
        return c.json(result)
      },
    )
    .delete(
      "/",
      describeRoute({
        summary: "Close browser",
        description: "Close the browser session.",
        operationId: "browser.close",
        responses: {
          200: {
            description: "Close result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    error: z.string().optional(),
                  })
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await Browser.close()
        return c.json(result)
      },
    ),
)
