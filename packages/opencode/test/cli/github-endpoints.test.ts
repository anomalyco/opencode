import { afterEach, describe, expect, test } from "bun:test"
import { createGitHubClients } from "../../src/cli/cmd/github.shared"

const endpointCases = [
  {
    name: "uses GitHub.com when both endpoint variables are unset",
    restBaseUrl: undefined,
    graphqlBaseUrl: undefined,
    expectedURLs: ["https://api.github.com/repos/acme/widgets", "https://api.github.com/graphql"],
  },
  {
    name: "uses GITHUB_API_URL only for REST and removes trailing slashes",
    restBaseUrl: "https://github.example.test/api/v3///",
    graphqlBaseUrl: undefined,
    expectedURLs: ["https://github.example.test/api/v3/repos/acme/widgets", "https://api.github.com/graphql"],
  },
  {
    name: "uses GITHUB_GRAPHQL_URL only for GraphQL",
    restBaseUrl: undefined,
    graphqlBaseUrl: "https://github.example.test/api/graphql",
    expectedURLs: ["https://api.github.com/repos/acme/widgets", "https://github.example.test/api/graphql"],
  },
  {
    name: "uses independent REST and GraphQL endpoints when both are set",
    restBaseUrl: "https://github.example.test/api/v3",
    graphqlBaseUrl: "https://github.example.test/api/graphql",
    expectedURLs: [
      "https://github.example.test/api/v3/repos/acme/widgets",
      "https://github.example.test/api/graphql",
    ],
  },
  {
    name: "does not duplicate a terminal GraphQL path when removing trailing slashes",
    restBaseUrl: undefined,
    graphqlBaseUrl: "https://github.example.test/api/graphql///",
    expectedURLs: ["https://api.github.com/repos/acme/widgets", "https://github.example.test/api/graphql"],
  },
  {
    name: "preserves a custom GraphQL base before the client appends its path",
    restBaseUrl: undefined,
    graphqlBaseUrl: "https://github.example.test/custom///",
    expectedURLs: ["https://api.github.com/repos/acme/widgets", "https://github.example.test/custom/graphql"],
  },
] as const

const originalGithubApiUrl = process.env["GITHUB_API_URL"]
const originalGithubGraphqlUrl = process.env["GITHUB_GRAPHQL_URL"]
const originalFetch = globalThis.fetch

function setEndpoint(variable: "GITHUB_API_URL" | "GITHUB_GRAPHQL_URL", value: string | undefined) {
  if (value === undefined) {
    delete process.env[variable]
    return
  }
  process.env[variable] = value
}

afterEach(() => {
  setEndpoint("GITHUB_API_URL", originalGithubApiUrl)
  setEndpoint("GITHUB_GRAPHQL_URL", originalGithubGraphqlUrl)
  globalThis.fetch = originalFetch
})

describe("createGitHubClients", () => {
  for (const endpointCase of endpointCases) {
    test(endpointCase.name, async () => {
      setEndpoint("GITHUB_API_URL", endpointCase.restBaseUrl)
      setEndpoint("GITHUB_GRAPHQL_URL", endpointCase.graphqlBaseUrl)
      const requests: Request[] = []
      globalThis.fetch = Object.assign(
        async (...[input, init]: Parameters<typeof fetch>) => {
          const request = new Request(input, init)
          requests.push(request)
          return new Response(JSON.stringify({ data: { repository: {} } }), {
            headers: { "content-type": "application/json" },
          })
        },
        { preconnect: originalFetch.preconnect },
      )
      const clientPromise = createGitHubClients("endpoint-test-token")
      expect(clientPromise).toBeInstanceOf(Promise)
      const clients = await clientPromise

      await clients.rest.rest.repos.get({ owner: "acme", repo: "widgets" })
      await clients.graph('query { repository(owner: "acme", name: "widgets") { id } }')

      expect(requests.map((request) => request.url)).toEqual([...endpointCase.expectedURLs])
      expect(requests.map((request) => request.headers.get("authorization"))).toEqual([
        "token endpoint-test-token",
        "token endpoint-test-token",
      ])
    })
  }
})
