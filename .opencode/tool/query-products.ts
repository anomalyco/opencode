/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const DESCRIPTION = `Query products from the brand's Shopify storefront catalog.
Search by keywords, filter by category, price range, or availability.
Returns product details including title, price, variants, images, and inventory status.

This tool wraps the Shopify MCP 'shopify-mock_search_shop_catalog' tool for easier integration.
Use this when agents need to:
- Search for specific products ("running shoes", "leather bags")
- Browse products by category or collection
- Check product availability and pricing
- Get product data for campaign creative generation

Data sources:
- nike, luxebags, freshfoods: Mock.shop (Shopify's official demo GraphQL API)
- hydrogenstore: Hydrogen Demo Store (Shopify's Hydrogen framework demo)`

const BRAND_CONFIG: Record<string, { endpoint: string; token?: string; source: string }> = {
  nike: {
    endpoint: "https://mock.shop/api/2024-07/graphql.json",
    source: "Mock.shop",
  },
  luxebags: {
    endpoint: "https://mock.shop/api/2024-07/graphql.json",
    source: "Mock.shop",
  },
  freshfoods: {
    endpoint: "https://mock.shop/api/2024-07/graphql.json",
    source: "Mock.shop",
  },
  hydrogenstore: {
    endpoint: "https://hydrogen-preview.myshopify.com/api/2026-01/graphql.json",
    token: "3b580e70970c4528da70c98e097c2fa0",
    source: "Hydrogen Demo Store",
  },
}

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier (nike, luxebags, freshfoods, hydrogenstore)")
      .default("nike"),
    query: tool.schema
      .string()
      .describe("Natural language search query (e.g., 'running shoes', 'black leather bags', 'organic vegetables')")
      .optional(),
    category: tool.schema
      .string()
      .describe("Product category filter (e.g., 'Shoes', 'Bags', 'Produce')")
      .optional(),
    min_price: tool.schema
      .number()
      .describe("Minimum price filter (in INR)")
      .optional(),
    max_price: tool.schema
      .number()
      .describe("Maximum price filter (in INR)")
      .optional(),
    available_only: tool.schema
      .boolean()
      .describe("Only return products in stock")
      .default(true),
    limit: tool.schema
      .number()
      .describe("Maximum number of products to return")
      .default(10),
  },
  async execute(args) {
    const config = BRAND_CONFIG[args.brand_id.toLowerCase()]
    if (!config) {
      return `Brand '${args.brand_id}' not configured. Available brands: ${Object.keys(BRAND_CONFIG).join(", ")}`
    }

    const searchTerms = []
    if (args.query) searchTerms.push(args.query)
    if (args.category) searchTerms.push(args.category)

    const searchQuery = searchTerms.join(" ") || "products"

    // Shopify Storefront API Query
    const GRAPHQL_QUERY = `
      query SearchProducts($query: String!, $first: Int!) {
        products(query: $query, first: $first) {
          edges {
            node {
              id
              title
              description
              vendor
              productType
              handle
              availableForSale
              priceRange {
                minVariantPrice {
                  amount
                  currencyCode
                }
              }
              images(first: 1) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
              variants(first: 5) {
                edges {
                  node {
                    id
                    title
                    price {
                      amount
                      currencyCode
                    }
                    availableForSale
                    sku
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }

      if (config.token) {
        headers["X-Shopify-Storefront-Access-Token"] = config.token
      }

      const response = await fetch(config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: GRAPHQL_QUERY,
          variables: {
            query: searchQuery,
            first: args.limit,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
      }

      const { data, errors } = (await response.json()) as { data: any; errors?: { message: string }[] };

      if (errors && errors.length > 0) {
        return `Error from Shopify API: ${errors.map((e: { message: string }) => e.message).join(", ")}`;
      }

      const products = data?.products?.edges || [];

      if (products.length === 0) {
        return `No products found for "${searchQuery}" in ${args.brand_id}.`;
      }

      let output = `# Product Search Results: ${args.brand_id.toUpperCase()}\n\n`;
      output += `Found ${products.length} products matching "${searchQuery}":\n\n`;

      products.forEach(({ node: p }: { node: any }) => {
        const price = p.priceRange.minVariantPrice;
        output += `### ${p.title}\n`;
        output += `- **ID**: ${p.id}\n`;
        output += `- **Price**: ${price.amount} ${price.currencyCode}\n`;
        output += `- **Status**: ${p.availableForSale ? "In Stock" : "Out of Stock"}\n`;
        output += `- **Description**: ${p.description.slice(0, 150)}${p.description.length > 150 ? "..." : ""}\n`;

        if (p.images.edges.length > 0) {
          output += `![${p.title}](${p.images.edges[0].node.url})\n`;
        }

        output += `\n**Variants:**\n`;
        p.variants.edges.forEach(({ node: v }: { node: any }) => {
          output += `- ${v.title}: ${v.price.amount} ${v.price.currencyCode} (${v.availableForSale ? "Available" : "Sold Out"})\n`;
        });
        output += `\n---\n`;
      });

      output += `\n*Data source: ${config.source}*`;

      return output;
    } catch (error) {
      return `Failed to query products: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
})
