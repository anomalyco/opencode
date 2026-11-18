import path from "path";
import fs from "fs";
import { Output, Resource, all, output } from "@pulumi/pulumi";
import { Prettify } from "../component";
import { Input } from "../input";
import { Link } from "../link.js";
import { VisibleError } from "../error.js";
import { BaseSiteDev } from "./base-site";
import { siteBuilder } from "../aws/helpers/site-builder";

export interface BaseSsrSiteArgs {
  dev?: false | Prettify<BaseSiteDev>;
  buildCommand?: Input<string>;
  environment?: Input<Record<string, Input<string>>>;
  link?: Input<any[]>;
  path?: Input<string>;
}

export function buildApp(
  parent: Resource,
  name: string,
  args: BaseSsrSiteArgs,
  sitePath: Output<string>,
  buildCommand?: Output<string>,
) {
  return all([
    sitePath,
    buildCommand ?? args.buildCommand,
    args.link,
    args.environment,
  ]).apply(([sitePath, userCommand, links, environment]) => {
    const cmd = resolveBuildCommand();
    const result = runBuild();
    return result.id.apply(() => sitePath);

    function resolveBuildCommand() {
      if (userCommand) return userCommand;

      // Ensure that the site has a build script defined
      if (!userCommand) {
        if (!fs.existsSync(path.join(sitePath, "package.json"))) {
          throw new VisibleError(`No package.json found at "${sitePath}".`);
        }
        const packageJson = JSON.parse(
          fs.readFileSync(path.join(sitePath, "package.json")).toString(),
        );
        if (!packageJson.scripts || !packageJson.scripts.build) {
          throw new VisibleError(
            `No "build" script found within package.json in "${sitePath}".`,
          );
        }
      }

      if (
        fs.existsSync(path.join(sitePath, "yarn.lock")) ||
        fs.existsSync(path.join($cli.paths.root, "yarn.lock"))
      )
        return "yarn run build";
      if (
        fs.existsSync(path.join(sitePath, "pnpm-lock.yaml")) ||
        fs.existsSync(path.join($cli.paths.root, "pnpm-lock.yaml"))
      )
        return "pnpm run build";
      if (
        fs.existsSync(path.join(sitePath, "bun.lockb")) ||
        fs.existsSync(path.join($cli.paths.root, "bun.lockb")) ||
        fs.existsSync(path.join(sitePath, "bun.lock")) ||
        fs.existsSync(path.join($cli.paths.root, "bun.lock"))
      )
        return "bun run build";

      return "npm run build";
    }

    function runBuild() {
      // Build link environment variables to inject
      const linkData = Link.build(links || []);
      const linkEnvs = output(linkData).apply((linkData) => {
        const envs: Record<string, string> = {
          SST_RESOURCE_App: JSON.stringify({
            name: $app.name,
            stage: $app.stage,
          }),
        };
        for (const datum of linkData) {
          envs[`SST_RESOURCE_${datum.name}`] = JSON.stringify(datum.properties);
        }
        return envs;
      });

      // Run build
      return siteBuilder(
        `${name}Builder`,
        {
          create: cmd,
          update: cmd,
          dir: path.join($cli.paths.root, sitePath),
          environment: linkEnvs.apply((linkEnvs) => ({
            SST: "1",
            ...process.env,
            ...environment,
            ...linkEnvs,
          })),
          triggers: [Date.now().toString()],
        },
        {
          parent,
          ignoreChanges: process.env.SKIP ? ["*"] : undefined,
        },
      );
    }
  });
}
