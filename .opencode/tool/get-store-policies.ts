/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"

const DESCRIPTION = `Query store policies, FAQs, and operational information from the Shopify storefront.
Returns information about:
- Shipping policies and delivery times
- Return and refund policies
- Privacy and terms of service
- Payment methods accepted
- Customer service contact information
- Frequently asked questions

Use this when agents need to:
- Answer customer service questions
- Understand store operational policies
- Generate policy-compliant marketing content
- Create customer support documentation

Data source: Mock.shop (Shopify's official demo GraphQL API)`

export default tool({
  description: DESCRIPTION,
  args: {
    brand_id: tool.schema
      .string()
      .describe("Brand identifier (nike, luxebags, freshfoods)")
      .default("nike"),
    query: tool.schema
      .string()
      .describe("Natural language query about policies or FAQs (e.g., 'shipping', 'returns', 'payment methods', 'warranty')")
      .default("all policies"),
  },
  async execute(args) {
    // This tool provides guidance for querying store policies via Shopify MCP
    return `# Store Policies Helper: ${args.brand_id.toUpperCase()}

## Requested Query
**Topic**: ${args.query}

---

## How to Query Store Policies

To retrieve store policies and FAQs, use the **Shopify MCP tool** directly:

\`\`\`
Use tool: shopify-mock_search_shop_policies_and_faqs
Parameters:
{
  "query": "${args.query}"
}
\`\`\`

This will return relevant policy information including:

### Shipping Policy
- Shipping methods and delivery times
- Shipping costs and free shipping thresholds
- International shipping (if applicable)
- Shipping carriers used
- Order processing time

### Return & Refund Policy
- Return window (e.g., 30 days)
- Return conditions (unused, with tags, etc.)
- Refund processing time
- Return shipping costs
- Exchanges vs refunds

### Payment Methods
- Accepted payment types
- Payment security
- Currency accepted
- Installment options (if applicable)

### Privacy & Terms
- Data collection and usage
- Terms of service
- Cookie policy
- GDPR compliance (if applicable)

### Customer Support
- Contact methods (email, phone, chat)
- Support hours
- Response time expectations
- FAQ resources

---

## Usage Guidelines

**For Customer Support**:
- Use this information to answer customer inquiries accurately
- Always provide complete policy details, not summaries
- Include relevant timelines and conditions
- Direct customers to specific policy sections

**For Marketing Content**:
- Ensure promotional materials comply with stated policies
- Highlight customer-friendly policies ("Free Shipping on ₹2,500+")
- Reference specific policy sections when making claims
- Include policy disclaimers in promotional emails

**For Campaign Planning**:
- Align campaign timing with shipping cutoffs for holidays
- Create campaigns around favorable policies ("30-Day Easy Returns")
- Include policy benefits in ad copy ("Free Returns • Secure Checkout")
- Plan promotions that work within policy constraints

**For Email Templates**:
- Include shipping policy in order confirmation emails
- Add return policy link to transactional emails
- Reference policies in footer of marketing emails
- Use policy highlights as trust signals

---

## Common Policy Topics

Query these specific topics for targeted information:

- **"shipping"** - Delivery times, costs, methods
- **"returns"** - Return window, process, conditions
- **"payment"** - Accepted methods, security
- **"warranty"** - Product guarantees, coverage
- **"privacy"** - Data protection, GDPR
- **"contact"** - Customer support, hours
- **"all policies"** - Complete policy overview

---

## MCP Server Status

To verify the Shopify MCP is connected:
1. Check server status: \`opencode mcp list\`
2. Ensure 'shopify-mock' shows as 'connected'
3. If not connected, check \`.opencode/opencode.jsonc\` configuration

---

## Generic Policy Structure (Fallback)

If MCP is not connected, here's typical e-commerce policy structure for "${args.brand_id}":

### Shipping Policy
- Standard shipping: 5-7 business days
- Express shipping: 2-3 business days
- Free shipping on orders over ₹2,500

### Return Policy
- 30-day return window from delivery date
- Items must be unused with original tags
- Refund processed within 7-10 business days

### Payment Methods
- Credit/Debit cards (Visa, Mastercard, RuPay)
- UPI and Net Banking
- Cash on Delivery (COD) available

### Customer Support
- Email: support@${args.brand_id}.com
- Phone: Available Mon-Fri 9AM-6PM IST
- Chat: Available on website

*Use the MCP tool for actual store-specific policies.*

---
*Generated at ${new Date().toISOString()}*`
  },
})
