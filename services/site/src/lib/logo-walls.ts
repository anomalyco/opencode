import { logoMetrics } from "~/component/site/logo-metrics"

/**
 * The logo row's logos under the home hero (LogoWall): company wordmarks (sources in
 * public/logos/companies/README.md), or the model providers OpenCode works with (marks from
 * models.dev). Data only, with no strings to translate, so the static pages' script can cycle them
 * without loading any (home.ts).
 */
export const logoWalls = {
  companies: [
    { name: "NVIDIA", logo: "nvidia" },
    { name: "Cloudflare", logo: "cloudflare" },
    { name: "Microsoft", logo: "microsoft" },
    { name: "GitHub", logo: "github" },
    { name: "ByteDance", logo: "bytedance" },
    { name: "Revolut", logo: "revolut" },
    { name: "Salesforce", logo: "salesforce" },
    { name: "Cisco", logo: "cisco" },
    { name: "Red Hat", logo: "red-hat" },
    { name: "Intel", logo: "intel" },
    { name: "Adobe", logo: "adobe" },
    { name: "IBM", logo: "ibm" },
    { name: "SAP", logo: "sap" },
    { name: "Lenovo", logo: "lenovo" },
    { name: "Linear", logo: "linear" },
    // Measured and ready to swap in: Shopee ("shopee"), Shopify ("shopify"), MongoDB ("mongodb"),
    // Inditex ("inditex"), Zara ("zara"), HackerOne ("hackerone") and Bosch ("bosch").
  ].map((item) => ({
    name: item.name,
    logo: `/logos/companies/${item.logo}.svg`,
    metrics: logoMetrics.companies[item.logo],
  })),
  providers: [
    { name: "Anthropic", logo: "anthropic" },
    { name: "OpenAI", logo: "openai" },
    { name: "Google", logo: "google" },
    { name: "GitHub Copilot", logo: "github-copilot" },
    { name: "xAI", logo: "xai" },
    { name: "DeepSeek", logo: "deepseek" },
    { name: "Mistral", logo: "mistral" },
    { name: "Ollama", logo: "ollama" },
    { name: "OpenRouter", logo: "openrouter" },
    { name: "Amazon Bedrock", logo: "amazon-bedrock" },
    { name: "Moonshot AI", logo: "moonshotai" },
    { name: "Z.ai", logo: "zai" },
  ].map((item) => ({
    name: item.name,
    logo: `/logos/providers/${item.logo}.svg`,
    metrics: logoMetrics.providers[item.logo],
  })),
}
