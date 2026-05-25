export const domain = (() => {
  if ($app.stage === "production") return "opencode.ai"
  if ($app.stage === "dev") return "dev.opencode.ai"
  return `${$app.stage}.dev.opencode.ai`
})()

export const zoneID = "430ba34c138cfb5360826c4909f99be8"
export const deployAws = $app.stage === "production" || $app.stage === "dev" || $app.stage === "adam"

const githubActionsDeployRole = (() => {
  if ($app.stage !== "dev" && $app.stage !== "production") return

  const provider = new aws.iam.OpenIdConnectProvider("GithubActionsOidcProvider", {
    url: "https://token.actions.githubusercontent.com",
    clientIdLists: ["sts.amazonaws.com"],
  })
  const role = new aws.iam.Role("GithubActionsDeployRole", {
    name: `opencode-${$app.stage}-github-actions-deploy`,
    maxSessionDuration: 3600,
    assumeRolePolicy: aws.iam.getPolicyDocumentOutput({
      statements: [
        {
          effect: "Allow",
          actions: ["sts:AssumeRoleWithWebIdentity"],
          principals: [{ type: "Federated", identifiers: [provider.arn] }],
          conditions: [
            {
              test: "StringEquals",
              variable: "token.actions.githubusercontent.com:aud",
              values: ["sts.amazonaws.com"],
            },
            {
              test: "StringEquals",
              variable: "token.actions.githubusercontent.com:sub",
              values: [`repo:anomalyco/opencode:environment:${$app.stage}`],
            },
          ],
        },
      ],
    }).json,
  })

  new aws.iam.RolePolicyAttachment("GithubActionsDeployRoleAdmin", {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
  })

  return role
})()

export const githubActionsDeployRoleArn = githubActionsDeployRole?.arn

new cloudflare.RegionalHostname("RegionalHostname", {
  hostname: domain,
  regionKey: "us",
  zoneId: zoneID,
})

export const shortDomain = (() => {
  if ($app.stage === "production") return "opncd.ai"
  if ($app.stage === "dev") return "dev.opncd.ai"
  return `${$app.stage}.dev.opncd.ai`
})()
