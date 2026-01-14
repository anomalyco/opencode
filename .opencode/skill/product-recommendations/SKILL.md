---
name: product-recommendations
description: Use for product recommendation workflows - catalog analysis, cross-sell/upsell suggestions, personalized product curation
---

# Product Recommendations Skill

You are executing a product recommendation workflow. This skill leverages real Shopify product data to create personalized product suggestions and catalog-driven campaigns.

## Required Inputs

Before starting, collect:
1. **Brand**: Which brand to analyze? (nike, luxebags, freshfoods)
2. **Context**: What's the use case? (customer inquiry, campaign planning, collection curation, upsell opportunity)
3. **Criteria**: What filters to apply? (price range, category, availability, customer segment)
4. **Goal**: What's the objective? (increase AOV, drive discovery, seasonal promotion, inventory clearance)

## Execution Steps

### Step 1: Context Loading
```
get_brand_context → Understand brand preferences and available tools
```

### Step 2: Product Data Collection (run in PARALLEL when possible)

Depending on the use case:

**For Broad Discovery**:
```
query_products → Search catalog by category/price/keywords
query_collections → Explore product collections and themes
```

**For Specific Product Focus**:
```
get_product_details → Get comprehensive product information
query_products → Find related/complementary products
```

**For Campaign Planning**:
```
query_collections → Browse available collections
query_products → Filter by campaign criteria (seasonal, price tier, etc.)
query_sales (if available) → Identify best-sellers and high performers
```

### Step 3: Analysis & Curation

Based on collected product data:
- Identify product patterns and opportunities
- Group complementary products
- Apply filters (price, availability, brand preferences)
- Score recommendations by relevance

### Step 4: Recommendation Generation

Create recommendations based on:
- **Customer Intent**: Match products to customer needs
- **Cross-sell**: Products that complement each other
- **Upsell**: Higher-value alternatives to initial choice
- **Discovery**: Introduce new/trending products
- **Clearance**: Move slow-moving inventory

### Step 5: Output & Next Actions

Provide:
- Curated product list with rationale
- Campaign creative suggestions (if needed)
- Email/ad copy recommendations (if needed)
- Performance predictions

## Output Format

```markdown
# Product Recommendations: [Brand] - [Use Case]

## Recommendation Context
- **Goal**: [Objective]
- **Criteria**: [Filters applied]
- **Product Source**: Shopify Storefront (Mock.shop)
- **Products Analyzed**: [Count]

## Recommended Products

### Tier 1: Primary Recommendations
| Product | Price | Reason | Action |
|---------|-------|--------|--------|
| [Name] | ₹X | [Why recommended] | [Suggested use] |
| [Name] | ₹X | [Why recommended] | [Suggested use] |

### Tier 2: Alternative Options
| Product | Price | Reason | Action |
|---------|-------|--------|--------|
| [Name] | ₹X | [Why recommended] | [Suggested use] |

### Tier 3: Discovery/Cross-sell
| Product | Price | Reason | Action |
|---------|-------|--------|--------|
| [Name] | ₹X | [Why recommended] | [Suggested use] |

## Bundling Opportunities

**Bundle 1**: [Products that go together]
- Combined Value: ₹X
- Bundle Discount: ₹X (X%)
- Use Case: [When to offer]

## Campaign Integration

**Recommended Approach**:
1. [Campaign strategy based on products]
2. [Creative direction]
3. [Targeting suggestions]

## Expected Impact

- **AOV Increase**: Estimated +X%
- **Conversion Lift**: Estimated +X%
- **Units per Transaction**: X → X

## Next Steps
1. [Immediate action]
2. [Creative asset needs]
3. [Campaign setup requirements]
```

## Use Case Examples

### 1. Customer Shopping Assistance
**Scenario**: Customer asks "What running shoes do you recommend for beginners?"

**Workflow**:
```
1. get_brand_context(brand_id="nike")
2. query_products(brand_id="nike", query="running shoes beginners", limit=5)
3. Analyze results → Filter by price (entry-level)
4. Create recommendation with 3-5 options
5. Suggest complementary products (socks, shorts)
```

### 2. Campaign Product Selection
**Scenario**: Planning a "Holiday Gift Guide" campaign

**Workflow**:
```
1. get_brand_context(brand_id="luxebags")
2. query_collections(brand_id="luxebags", collection_query="gift")
3. query_products(brand_id="luxebags", category="accessories", max_price=15000)
4. Curate 10-15 "Gift-worthy" products
5. Create gift guide structure (by price tier, recipient type)
```

### 3. Upsell Opportunity
**Scenario**: Customer viewing mid-tier product, suggest premium alternative

**Workflow**:
```
1. get_product_details(brand_id="luxebags", product_identifier="tote bag")
2. query_products(brand_id="luxebags", category="handbags", min_price=[current_price])
3. Identify 2-3 premium alternatives
4. Create comparison table (features, benefits, price difference)
```

### 4. Inventory Clearance
**Scenario**: Need to move slow-moving seasonal inventory

**Workflow**:
```
1. get_brand_context(brand_id="freshfoods")
2. query_products(brand_id="freshfoods", category="seasonal", available_only=true)
3. query_sales → Identify slow movers (if sales data available)
4. Create "Limited Time" campaign recommendations
5. Suggest bundling with fast-movers
```

## Integration with Other Tools

### With Sales Data
```
query_sales → Identify best-sellers
query_products → Get product details for top performers
Create "Best Sellers" collection
```

### With Creative Execution
```
query_products → Get recommended products
get_product_details → Get images, descriptions
run_space(copy_generation) → Create product copy
run_space(image_generation) → Create lifestyle images
```

### With Email Campaigns
```
query_products → Curate product selection
get_store_policies → Get shipping/return info for footer
run_space(email_generation) → Create product showcase email
```

## Important Notes

- Always use real product data from Shopify (via query_products, get_product_details)
- Indicate data source: "Shopify Storefront data (Mock.shop)"
- Verify product availability before recommending
- Match recommendations to brand voice and preferences (from get_brand_context)
- Consider seasonal relevance and current trends
- Include pricing in all recommendations
- Suggest bundles and cross-sells where appropriate

## ROI Metrics to Track

When implementing recommendations:
- **Click-Through Rate**: On recommended products
- **Add-to-Cart Rate**: From recommendations
- **AOV Increase**: When recommendations are shown
- **Conversion Rate**: On recommendation sections
- **Bundle Adoption**: Percentage of bundled purchases

---

**Manual vs ShopOS**:
- **Manual**: Hours of spreadsheet work, guessing what's in stock, outdated pricing
- **ShopOS**: Real-time catalog access, accurate data, intelligent filtering - completed in minutes
