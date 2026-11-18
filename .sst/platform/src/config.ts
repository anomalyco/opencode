/**
 * The `sst.config.ts` file is used to configure your SST app and its resources.
 *
 * ```ts
 * $config(input: Config): Config
 * ```
 *
 * You specify it using the `$config` function. This takes an object of type [`Config`](#config).
 *
 * ```ts title="sst.config.ts"
 * /// <reference path="./.sst/platform/config.d.ts" />
 *
 * export default $config({
 *   // Your app's config
 *   app(input) {
 *     return {
 *       name: "my-sst-app",
 *       home: "aws"
 *     };
 *   },
 *   // Your app's resources
 *   async run() {
 *     const bucket = new sst.aws.Bucket("MyBucket");
 *
 *     // Your app's outputs
 *     return {
 *       bucket: bucket.name
 *     };
 *   },
 *   // Optionally, your app's Console config
 *   console: {
 *     autodeploy: {
 *       runner: { compute: "large" }
 *     }
 *   }
 * });
 * ```
 *
 * The `Config` object takes:
 * 1. [`app`](#app-2) — Your config
 * 2. [`run`](#run) — Your resources
 * 3. [`console`](#console) — Optionally, your app's Console config
 *
 * The `app` function is evaluated right when your app loads. It's used to define the app config and its providers.
 *
 * :::note
 * You need TypeScript 5 to see the types in your config.
 * :::
 *
 * You can add Pulumi code in the `run` function not the `app` function. While the `run`
 * function is where you define your resources using SST or Pulumi's components.
 *
 * The run function also has access to a list of [Global](/docs/reference/global/) `$` variables and functions. These serve as the context for your app config.
 *
 * :::caution
 * Do not `import` the provider packages in your `sst.config.ts`.
 * :::
 *
 * Since SST manages importing your provider packages, it's recommended not to add any imports
 * in your `sst.config.ts`.
 *
 * ---
 *
 * #### .env
 *
 * Your `.env` and `.env.<stage>` files are loaded as environment variables in your config.
 * They need to be in the same directory as your `sst.config.ts`.
 *
 * ```bash title=".env"
 * MY_ENV_VAR=hello
 * ```
 *
 * And are available as `process.env` in both your `app` and `run` functions.
 *
 * ```ts title="sst.config.ts"
 * process.env.MY_ENV_VAR
 * ```
 *
 * The `.env` file takes precedence over `.env.<stage>`. So if you have a `.env` and a
 * `.env.dev` file, the values in the `.env` file will be used.
 *
 * :::note
 * You need to restart `sst dev` for changes in your `.env` files to take effect.
 * :::
 *
 * Make sure the stage name in your `.env.<stage>` matches the stage your app is running on.
 *
 * @packageDocumentation
 */
import type { Shell } from "bun";

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export interface App {
  /**
   * The version of SST supported by the app. The CLI will fail any commands if the version does
   * not match.
   *
   * :::tip
   * Useful in CI where you don't want it to automatically deploy with a new version of SST.
   * :::
   *
   * @default The latest version of SST.
   *
   * @example
   *
   * Takes a specific version.
   *
   * ```ts
   * version: "3.2.49"
   * ```
   *
   * Also supports semver ranges.
   * ```ts
   * version: ">= 3.2.49"
   * ```
   */
  version?: string;
  /**
   * The name of the app. This is used to prefix the names of the resources in your app.
   *
   * :::caution
   * If you change the name of your app, it'll redeploy your app with new resources. The old resources will be orphaned.
   * :::
   *
   * This means that you don't want to change the name of your app without removing the old resources first.
   *
   * @example
   *
   * ```ts
   * {
   *   name: "my-sst-app"
   * }
   * ```
   */
  name: string;
  /**
   * Configure how your resources are handled when they have to be removed.
   *
   * - `remove`: Removes the underlying resource.
   * - `retain`: Retains resources like S3 buckets and DynamoDB tables. Removes everything else.
   * - `retain-all`: Retains all resources.
   *
   * :::tip
   * If you change your removal policy, you'll need to deploy your app once for it to take
   * effect.
   * :::
   *
   * For example, retain resources if it's the _production_ stage, otherwise remove all
   * resources.
   *
   * ```ts
   * {
   *   removal: input.stage === "production" ? "retain" : "remove"
   * }
   * ```
   *
   * This applies to not just the `sst remove` command but also cases where you remove a
   * resource from the `sst.config.ts` and run `sst dev` or `sst deploy`.
   *
   * <VideoAside title="Watch a video on how to protect your prod resources" href="https://youtu.be/fb6UBGwgDuA" />
   *
   * To control how a stage is handled on `sst remove`, check out the `protect` prop.
   *
   * @default `"retain"`
   */
  removal?: "remove" | "retain" | "retain-all";
  /**
   * The providers that are being used in this app. This allows you to use the resources from
   * these providers in your app.
   *
   * ```ts
   * {
   *   providers: {
   *     aws: "6.27.0",
   *     cloudflare: "5.37.1"
   *   }
   * }
   * ```
   *
   * Check out the full list in the [Directory](/docs/all-providers#directory).
   *
   * :::tip
   * You'll need to run `sst install` after you update the `providers` in your config.
   * :::
   *
   * If you don't set a `provider` it uses your `home` provider with the default config. So if you set `home` to `aws`, it's the same as doing:
   *
   * ```ts
   * {
   *   home: "aws",
   *   providers: {
   *     aws: "6.27.0"
   *   }
   * }
   * ```
   *
   * You can also configure the provider props. Here's the config for some common providers:
   * - [AWS](https://www.pulumi.com/registry/packages/aws/api-docs/provider/#inputs)
   * - [Cloudflare](https://www.pulumi.com/registry/packages/cloudflare/api-docs/provider/#inputs)
   *
   * @example
   *
   * For example, to change the region for AWS.
   *
   * ```ts
   * {
   *   providers: {
   *     aws: {
   *       region: "us-west-2"
   *     }
   *   }
   * }
   * ```
   *
   * @default The `home` provider.
   */
  providers?: Record<string, any>;
  /**
   * The provider SST will use to store the state for your app. The state keeps track of all your resources and secrets. The state is generated locally and backed up in your cloud provider.
   *
   *
   * Currently supports AWS, Cloudflare and local.
   *
   * :::tip
   * SST uses the `home` provider to store the state for your app. If you use the local provider it will be saved on your machine. You can see where by running `sst version`.
   * :::
   *
   * If you want to configure the aws or cloudflare home provider, you can:
   *
   * ```ts
   * {
   *   home: "aws",
   *   providers: {
   *     aws: {
   *       region: "us-west-2"
   *     }
   *   }
   * }
   * ```
   *
   */
  home: "aws" | "cloudflare" | "local";

  /**
   * If set to `true`, the `sst remove` CLI will not run and will error out.
   *
   * This is useful for preventing cases where you run `sst remove --stage <stage>` for the
   * wrong stage.
   *
   * :::tip
   * Protect your production stages from being accidentally removed.
   * :::
   *
   * For example, prevent the _production_ stage from being removed.
   *
   * ```ts
   * {
   *   protect: input.stage === "production"
   * }
   * ```
   *
   * However, this only applies to `sst remove` for stages.
   *
   * <VideoAside title="Watch a video on how to protect your prod resources" href="https://youtu.be/fb6UBGwgDuA" />
   *
   * If you accidentally remove a resource from the `sst.config.ts` and run `sst deploy` or
   * `sst dev`, it'll still get removed. To avoid this, check out the `removal` prop.
   */
  protect?: boolean;
}

export interface AppInput {
  /**
   * The stage this app is running on. This is a string that can be passed in through the CLI.
   *
   * :::caution
   * Changing the stage will redeploy your app to a new stage with new resources. The old resources will still be around in the old stage.
   * :::
   *
   * If not passed in, it'll use the username of your local machine, or prompt you for it.
   */
  stage: string;
}

export interface RunnerInput {
  /**
   * The stage the deployment will be run in.
   */
  stage: string;
}

export interface Runner {
  /**
   * The service used to run the build. Currently, only AWS CodeBuild is supported.
   */
  engine: "codebuild";
  /**
   * The timeout for the build. It can be from `5 minutes` to `36 hours`.
   * @default `1 hour`
   */
  timeout?: `${number} ${"minute" | "minutes" | "hour" | "hours"}`;
  /**
   * The architecture of the build machine.
   *
   * The `x86_64` machine uses the [`al/standard/5.0`](https://github.com/aws/aws-codebuild-docker-images/tree/master/al/x86_64/standard/5.0) build image.
   * While `arm64` uses the [`al/aarch64/standard/3.0`](https://github.com/aws/aws-codebuild-docker-images/tree/master/al/aarch64/standard/3.0) image instead.
   *
   * You can also configure what's used in the image:
   *
   * - **Node**
   *
   *   To specify the version of Node you want to use in your build, you can use the
   *   `.node-version`, `.nvmrc`, or use the `engine` field in your `package.json`.
   *
   *   <Tabs>
   *     <TabItem label="package.json">
   *     ```js title="package.json"
   *     {
   *       engine: {
   *         node: "20.15.1"
   *       }
   *     }
   *     ```
   *     </TabItem>
   *     <TabItem label="node-version">
   *     ```bash title=".node-version"
   *     20.15.1
   *     ```
   *     </TabItem>
   *     <TabItem label="nvmrc">
   *     ```bash title=".nvmrc"
   *     20.15.1
   *     ```
   *     </TabItem>
   *   </Tabs>
   *
   * - **Package manager**
   *
   *   To specify the package manager you want to use you can configure it through your
   *   `package.json`.
   *
   *   <Tabs>
   *     <TabItem label="pnpm">
   *     ```js title="package.json"
   *     {
   *       packageManager: "pnpm@8.6.3"
   *     }
   *     ```
   *     </TabItem>
   *     <TabItem label="bun">
   *     ```js title="package.json"
   *     {
   *       packageManager: "bun@1.2.0"
   *     }
   *     ```
   *     </TabItem>
   *   </Tabs>
   *
   * Feel free to get in touch if you want to use your own build image or
   * configure what's used in the build image.
   *
   * @default `x86_64`
   */
  architecture?: "x86_64" | "arm64";
  /**
   * The compute size of the build environment.
   *
   * For `x86_64`, the following compute sizes are supported:
   * - `small`: 3 GB, 2 vCPUs
   * - `medium`: 7 GB, 4 vCPUs
   * - `large`: 15 GB, 8 vCPUs
   * - `xlarge`: 70 GB, 36 vCPUs
   * - `2xlarge`: 145 GB, 72 vCPUs
   *
   * For `arm64` architecture, the following compute sizes are supported:
   * - `small`: 4 GB, 2 vCPUs
   * - `medium`: 8 GB, 4 vCPUs
   * - `large`: 16 GB, 8 vCPUs
   * - `xlarge`: 64 GB, 32 vCPUs
   * - `2xlarge`: 96 GB, 48 vCPUs
   *
   * To increase the memory used by your Node.js process in the build environment, you'll want
   * to set the `NODE_OPTIONS` environment variable to `--max-old-space-size=xyz`. Where `xyz`
   * is the memory size in MB. By default, this is set to 1.5 GB.
   *
   * Read more about the [CodeBuild build environments](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html).
   *
   * @default `medium`
   */
  compute?: "small" | "medium" | "large" | "xlarge" | "2xlarge";
  /**
   * The VPC to run the build in. If provided, the build environment will have access to
   * resources in the VPC.
   *
   * This is useful for building Next.js apps that might make queries to your database
   * as a part of the build process.
   *
   * You can get these from the outputs of the `Vpc` component your are using or from the
   * [Console](/docs/console/#resources).
   *
   * @example
   *
   * ```ts
   * {
   *   vpc: {
   *     id: "vpc-0be8fa4de860618bb",
   *     subnets: ["subnet-0be8fa4de860618bb"],
   *     securityGroups: ["sg-0be8fa4de860618bb"]
   *   }
   * }
   * ```
   */
  vpc?: {
    /**
     * The ID of the VPC.
     */
    id: string;
    /**
     * The subnets to run the build in.
     */
    subnets: string[];
    /**
     * The security groups to run the build in.
     */
    securityGroups: string[];
  };
  /**
   * Paths to cache as a part of the build. By default the `.git` directory is cached.
   *
   * The given list of files and directories will be saved to the cache at the end of the build.
   * And they will be restored at the start of the build process.
   *
   * ```ts
   * {
   *   cache: {
   *     paths: ["node_modules", "/path/to/cache"]
   *   }
   * }
   * ```
   *
   * The relative paths are for caching files inside your repo. While the absolute path is for
   * any global caches.
   *
   * To clear the cache, you can trigger a new deploy using the **Force** deploy option in the
   * Console.
   */
  cache?: {
    /**
     * The paths to cache. These are relative to the root of the repository.
     *
     * By default, the `.git` directory is always cached.
     */
    paths: string[];
  };
}

interface GitSender {
  /**
   * The ID of the user.
   */
  id: number;
  /**
   * The username of the user.
   */
  username: string;
}

interface GitCommit {
  /**
   * The ID of the commit.
   */
  id: string;
  /**
   * The commit message.
   */
  message: string;
}

interface GitRepo {
  /**
   * The ID of the repo. This is usually a number.
   */
  id: number;
  /**
   * The name of the owner or org the repo to belongs to.
   */
  owner: string;
  /**
   * The name of the repo.
   */
  repo: string;
}

/**
 * A git event for when a branch is updated or deleted. For example:
 * ```js
 * {
 *   type: "branch",
 *   action: "pushed",
 *   repo: {
 *     id: 1296269,
 *     owner: "octocat",
 *     repo: "Hello-World"
 *   },
 *   branch: "main",
 *   commit: {
 *     id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
 *     message: "Update the README with new information"
 *   },
 *   sender: {
 *     id: 1,
 *     username: "octocat"
 *   }
 * }
 * ```
 */
export interface BranchEvent {
  /**
   * The git event type, for the `BranchEvent` it's `branch`.
   */
  type: "branch";
  /**
   * The type of the git action.
   *
   * - `pushed` is when you git push to a branch
   * - `removed` is when a branch is removed
   */
  action: "pushed" | "removed";
  /**
   * The Git repository the event is coming from. This might look like:
   *
   * ```js
   * {
   *   id: 1296269,
   *   owner: "octocat",
   *   repo: "Hello-World"
   * }
   * ```
   */
  repo: Prettify<GitRepo>;
  /**
   * The name of the branch the event is coming from.
   */
  branch: string;
  /**
   * Info about the commit in the event. This might look like:
   *
   * ```js
   * {
   *   id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
   *   message: "Update the README with new information"
   * }
   * ```
   */
  commit: Prettify<GitCommit>;
  /**
   * The user that generated the event. For example:
   *
   * ```js
   * {
   *   id: 1,
   *   username: "octocat"
   * }
   * ```
   */
  sender: Prettify<GitSender>;
}

/**
 * A git event for when a tag is created or deleted. For example:
 * ```js
 * {
 *   type: "tag",
 *   action: "pushed",
 *   repo: {
 *     id: 1296269,
 *     owner: "octocat",
 *     repo: "Hello-World"
 *   },
 *   tag: "v1.5.2",
 *   commit: {
 *     id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
 *     message: "Update the README with new information"
 *   },
 *   sender: {
 *     id: 1,
 *     username: "octocat"
 *   }
 * }
 * ```
 */
export interface TagEvent {
  /**
   * The git event type, for the `TagEvent` it's `tag`.
   */
  type: "tag";
  /**
   * The type of the git action.
   *
   * - `pushed` is when you create a tag
   * - `removed` is when a tag is removed
   */
  action: "pushed" | "removed";
  /**
   * The Git repository the event is coming from. This might look like:
   *
   * ```js
   * {
   *   id: 1296269,
   *   owner: "octocat",
   *   repo: "Hello-World"
   * }
   * ```
   */
  repo: Prettify<GitRepo>;
  /**
   * The name of the tag. For example, `v1.5.2`.
   */
  tag: string;
  /**
   * Info about the commit in the event. This might look like:
   *
   * ```js
   * {
   *   id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
   *   message: "Update the README with new information"
   * }
   * ```
   */
  commit: Prettify<GitCommit>;
  /**
   * The user that generated the event. For example:
   *
   * ```js
   * {
   *   id: 1,
   *   username: "octocat"
   * }
   * ```
   */
  sender: Prettify<GitSender>;
}

/**
 * A git event for when a pull request is updated or deleted. For example:
 *
 * ```js
 * {
 *   type: "pull_request",
 *   action: "pushed",
 *   repo: {
 *     id: 1296269,
 *     owner: "octocat",
 *     repo: "Hello-World"
 *   },
 *   number: 1347,
 *   base: "main",
 *   head: "feature",
 *   commit: {
 *     id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
 *     message: "Update the README with new information"
 *   },
 *   sender: {
 *     id: 1,
 *     username: "octocat"
 *   }
 * }
 * ```
 */
export interface PullRequestEvent {
  /**
   * The git event type, for the `PullRequestEvent` it's `pull_request`.
   */
  type: "pull_request";
  /**
   * The type of the git action.
   *
   * - `pushed` is when you git push to the base branch of the PR
   * - `removed` is when the PR is closed or merged
   */
  action: "pushed" | "removed";
  /**
   * The Git repository the event is coming from. This might look like:
   *
   * ```js
   * {
   *   id: 1296269,
   *   owner: "octocat",
   *   repo: "Hello-World"
   * }
   * ```
   */
  repo: Prettify<GitRepo>;
  /**
   * The pull request number.
   */
  number: number;
  /**
   * The title of the pull request.
   */
  title: string;
  /**
   * The base branch of the PR. This is the branch the code is being merged into.
   */
  base: string;
  /**
   * The head branch of the PR. This is the branch the code is coming from.
   */
  head: string;
  /**
   * Info about the commit in the event. This might look like:
   *
   * ```js
   * {
   *   id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
   *   message: "Update the README with new information"
   * }
   * ```
   */
  commit: Prettify<GitCommit>;
  /**
   * The user that generated the event. For example:
   *
   * ```js
   * {
   *   id: 1,
   *   username: "octocat"
   * }
   * ```
   */
  sender: Prettify<GitSender>;
}

/**
 * A user event for when the user manually triggers a deploy. For example:
 * ```js
 * {
 *   type: "user",
 *   action: "deploy",
 *   repo: {
 *     id: 1296269,
 *     owner: "octocat",
 *     repo: "Hello-World"
 *   },
 *   ref: "main",
 *   commit: {
 *     id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
 *     message: "Update the README with new information"
 *   }
 * }
 * ```
 */
export interface UserEvent {
  /**
   * The user event type.
   */
  type: "user";
  /**
   * The type of the user action.
   *
   * - `deploy` is when you manually trigger a deploy
   * - `remove` is when you manually remove a stage
   */
  action: "deploy" | "remove";
  /**
   * The Git repository the event is coming from. This might look like:
   *
   * ```js
   * {
   *   id: 1296269,
   *   owner: "octocat",
   *   repo: "Hello-World"
   * }
   * ```
   */
  repo: Prettify<GitRepo>;
  /**
   * The reference to the Git commit. This can be the branch, tag, or commit hash.
   */
  ref: string;
  /**
   * Info about the commit in the event. This might look like:
   *
   * ```js
   * {
   *   id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
   *   message: "Update the README with new information"
   * }
   * ```
   */
  commit: Prettify<GitCommit>;
}

export interface Target {
  /**
   * The stage or a list of stages the app will be deployed to.
   */
  stage: string | string[];
}

export interface WorkflowInput {
  /**
   * The [Bun shell](https://bun.sh/docs/runtime/shell). It's a cross-platform
   * _bash-like_ shell for scripting with JavaScript and TypeScript.
   */
  $: Shell;
  /**
   * The event that triggered the workflow.
   *
   * This includes git branch, pull request, or tag events. And it also
   * includes a user event for manual deploys that are triggered through the
   * Console.
   */
  event: BranchEvent | PullRequestEvent | TagEvent | UserEvent;
}

export interface Config {
  /**
   * The config for your app. It needs to return an object of type [`App`](#app-1). The `app`
   * function is evaluated when your app loads.
   *
   * :::caution
   * You cannot define any components or resources in the `app` function.
   * :::
   *
   * Here's an example of a simple `app` function.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * app(input) {
   *   return {
   *     name: "my-sst-app",
   *     home: "aws",
   *     providers: {
   *       aws: true,
   *       cloudflare: {
   *         accountId: "6fef9ed9089bb15de3e4198618385de2"
   *       }
   *     },
   *     removal: input.stage === "production" ? "retain" : "remove"
   *   };
   * },
   * ```
   */
  app(input: AppInput): App | Promise<App>;
  /**
   * Configure how your app works with the SST Console.
   */
  console?: {
    /**
     * Auto-deploys your app when you _git push_ to your repo. Uses
     * [AWS CodeBuild](https://aws.amazon.com/codebuild/) in your account to run the build.
     *
     * To get started, first [make sure to set up Autodeploy](/docs/console#setup).
     * Specifically, you need to configure an environment with the stage and AWS account
     * you want to auto-deploy to.
     *
     * Now when you _git push_ to a branch, pull request, or tag, the following happens:
     *
     * 1. The stage name is generated based on the `autodeploy.target` callback.
     *    1. If there is no callback, the stage name is a sanitized version of the branch or tag.
     *    2. If there is a callback but no stage is returned, the deploy is skipped.
     * 2. The runner config is generated based on the `autodeploy.runner`. Or the defaults are
     *    used.
     * 3. The stage is matched against the environments in the Console to get the AWS account
     *    and any environment variables for the deploy.
     * 4. The deploy is run based on the above config.
     *
     * This only applies only to git events. If you trigger a deploy through the Console, you
     * are asked to sepcify the stage you want to deploy to. So in this case, it skips step 1
     * from above and does not call `autodeploy.target`.
     *
     * You can further configure Autodeploy through the `autodeploy` prop.
     *
     * ```ts title="sst.config.ts"
     * console: {
     *   autodeploy: {
     *     target(event) {}, // Customize the target stage
     *     runner(stage) {}, // Customize the runner
     *     async workflow({ $, input }) {} // Customize the workflow
     *   }
     * }
     * ```
     *
     * Here, `target`, `runner`, and `workflow` are all optional and come with defaults, so
     * you don't need to configure anything. But you can customize them.
     *
     * ```ts
     * {
     *   autodeploy: {
     *     target(event) {
     *       if (
     *         event.type === "branch" &&
     *         event.branch === "main" &&
     *         event.action === "pushed"
     *        ) {
     *         return { stage: "production" };
     *       }
     *     },
     *     runner(stage) {
     *       if (stage === "production") return { timeout: "3 hours" };
     *     }
     *   }
     * }
     * ```
     *
     * For example, here we are only auto-deploying to the `production` stage when you git push
     * to the `main` branch. We are also setting the timeout to 3 hours for the `production`
     * stage. You can read more about the `target` and `runner` props below.
     *
     * Finally, if you want to configure exactly what happens in the build, you can pass in
     * a `workflow` function.
     *
     * ```ts
     * {
     *   autodeploy: {
     *     async workflow({ $, event }) {
     *       await $`npm i -g pnpm`;
     *       await $`pnpm i`;
     *       event.action === "removed"
     *         ? await $`pnpm sst remove`
     *         : await $`pnpm sst deploy`;
     *     }
     *   }
     * }
     * ```
     *
     * You can read more the `workflow` prop below.
     *
     * @default Auto-deploys branches and PRs.
     */
    autodeploy: {
      /**
       * Defines the stage or a list of stages the app will be auto-deployed to.
       *
       * When a git event is received, Autodeploy will run the `target` function with the
       * git event. This function should return the stage or a list of stages the app will
       * be deployed to. Or `undefined` if the deploy should be skipped.
       *
       * :::tip
       * Return `undefined` to skip the deploy.
       * :::
       *
       * The stage that is returned is then compared to the environments set in the
       * [app settings in the Console](/docs/console/#setup). If the stage matches an
       * environment, the stage will be deployed to that environment. If no matching environment
       * is found, the deploy will be skipped.
       *
       * :::note
       * You need to configure an environment in the Console to be able to deploy to it.
       * :::
       *
       * Currently, only git events for **branches**, **pull requests**, and **tags** are
       * supported.
       *
       * :::tip
       * This is not called when you manually trigger a deploy through the Console.
       * :::
       *
       * This config only applies to git events. If you trigger a deploy through the Console,
       * you are asked to sepcify the stage you want to deploy to. In this case, and
       * when you redeploy a manual deploy, the `target` function is not called.
       *
       * By default, this is what the `target` function looks like:
       *
       * ```ts
       * {
       *   target(event) {
       *     if (event.type === "branch" && event.action === "pushed") {
       *       return {
       *         stage: event.branch
       *           .replace(/[^a-zA-Z0-9-]/g, "-")
       *           .replace(/-+/g, "-")
       *           .replace(/^-/g, "")
       *           .replace(/-$/g, "")
       *       };
       *     }
       *
       *     if (event.type === "pull_request") {
       *       return { stage: `pr-${event.number}` };
       *     }
       *   }
       * }
       * ```
       *
       * So for a:
       *
       * - **branch**: The stage name is a sanitized version of the branch name. When a branch
       *   is removed, the stage is **not removed**.
       * - **pull request**: The stage name is `pr-<number>`. When a pull request is closed,
       *   the stage **is removed**.
       *
       * :::tip
       * Git events to tags are not auto-deployed by default.
       * :::
       *
       * Git events to tags are not auto-deployed by default. You can change this by adding it
       * to your config.
       *
       * ```ts
       * {
       *   target(event) {
       *     if (event.type === "tag" && event.action === "pushed") {
       *       return {
       *         stage: "tag-" + event.tag
       *           .replace(/[^a-zA-Z0-9-]/g, "-")
       *           .replace(/-+/g, "-")
       *           .replace(/^-/g, "")
       *           .replace(/-$/g, "")
       *       };
       *     }
       *   }
       * }
       * ```
       *
       * Here, similar to the branch event, we are sanitizing the tag name to generate the stage.
       * Just make sure to configure the environment for these tag stages in the Console.
       *
       * If you don't want to auto-deploy for a given event, you can return `undefined`. For
       * example, to skip any deploys to the `staging` stage.
       *
       * ```ts {3}
       * {
       *   target(event) {
       *     if (event.type === "branch" && event.branch === "staging") return;
       *     if (
       *       event.type === "branch" &&
       *       event.branch === "main" &&
       *       event.action === "pushed"
       *     ) {
       *       return { stage: "production" };
       *     }
       *   }
       * }
       * ```
       */
      target?(
        input: BranchEvent | PullRequestEvent | TagEvent,
      ): Target | undefined;
      /**
       * Configure the runner that will run the build. By default it uses the following config:
       *
       * ```ts
       * {
       *   runner: {
       *     engine: "codebuild",
       *     architecture: "x86_64",
       *     compute: "medium",
       *     timeout: "1 hour"
       *   }
       * }
       * ```
       *
       * Most of these are optional and come with defaults. But you can configure them.
       *
       * ```ts
       * {
       *   runner: { timeout: "3 hours" }
       * }
       * ```
       *
       * You can also configure it based on the stage that's being deployed. Let's say you
       * want to use the defaults for all stages except for `production`.
       *
       * ```ts
       * {
       *   runner(stage) {
       *     if (stage === "production") return { timeout: "3 hours" };
       *   }
       * }
       * ```
       *
       * Aside from the above, you can also have the deploys run inside a VPC.
       *
       * ```ts
       * {
       *   runner: {
       *     vpc: {
       *       id: "vpc-0be8fa4de860618bb",
       *       securityGroups: ["sg-0399348378a4c256c"],
       *       subnets: ["subnet-0b6a2b73896dc8c4c", "subnet-021389ebee680c2f0"]
       *     }
       *   }
       * }
       * ```
       *
       * Or configure files or directories to be cached.
       *
       * ```ts
       * {
       *   runner: {
       *     cache: {
       *       paths: ["node_modules", "/path/to/cache"]
       *     }
       *   }
       * }
       * ```
       *
       * A _runner_ is a [AWS CodeBuild](https://aws.amazon.com/codebuild/) project and an
       * IAM Role. This is created in **your account**.
       *
       * Once a runner is created, it can be used to run multiple builds of the same
       * machine config concurrently. Runners are also shared across all apps in the same
       * account and region.
       *
       * :::note
       * You are only charged for the number of build minutes that you use.
       * :::
       *
       * If a runner with a given config has been been previously created,
       * it'll be reused. The Console will also automatically remove runners that
       * have not been used for more than 7 days.
       *
       * You are not charged for the number of runners you have, only for the number of build
       * minutes that you use. The pricing is based on the machine config used.
       * [Learn more about CodeBuild pricing](https://aws.amazon.com/codebuild/pricing/).
       */
      runner?: Runner | ((input: RunnerInput) => Runner);
      /**
       * Customize the commands that are run during the build process. This is
       * useful for running tests, or completely customizing the build process.
       *
       * The default workflow automatically figures out the package manager you
       * are using, installs the dependencies, and runs `sst deploy` or `sst remove`
       * based on the event.
       *
       * For example, if you are using pnpm, the following is equivalent to the
       * default workflow.
       *
       * ```ts
       * {
       *   async workflow({ $, event }) {
       *     await $`npm i -g pnpm`;
       *     await $`pnpm i`;
       *     event.action === "removed"
       *       ? await $`pnpm sst remove`
       *       : await $`pnpm sst deploy`;
       *   }
       * }
       * ```
       *
       * The workflow function is run inside a Bun process. It passes in `$`
       * as the [Bun Shell](https://bun.sh/docs/runtime/shell). This makes
       * _bash-like_ scripting easier.
       *
       * :::tip
       * Use the Bun Shell to make running commands easier.
       * :::
       *
       * For example, here's how you can run tests before deploying.
       *
       * ```ts {5}
       * {
       *   async workflow({ $, event }) {
       *     await $`npm i -g pnpm`;
       *     await $`pnpm i`;
       *     await $`pnpm test`;
       *     event.action === "removed"
       *       ? await $`pnpm sst remove`
       *       : await $`pnpm sst deploy`;
       *   }
       * }
       * ```
       *
       * When you pass in a `workflow`, you are effectively taking control of what
       * runs in your build.
       *
       * :::caution
       * If you don't run `sst deploy`, your app won't be deployed.
       * :::
       *
       * This means that if you don't run `sst deploy`, your app won't be deployed.
       *
       * :::tip
       * Throwing an error will fail the build and display the error in the Console.
       * :::
       *
       * If you throw an error in the workflow, the deploy will fail and the error
       * will be displayed in the Autodeploy logs.
       *
       * Here's a more detailed example of using the Bun Shell to handle failures.
       *
       * ```ts {6,9}
       * {
       *   async workflow({ $, event }) {
       *     await $`npm i -g pnpm`;
       *     await $`pnpm i`;
       *
       *     const { exitCode } = await $`pnpm test`.nothrow();
       *     if (exitCode !== 0) {
       *       // Process the test report and then fail the build
       *       throw new Error("Failed to run tests");
       *     }
       *
       *     event.action === "removed"
       *       ? await $`pnpm sst remove`
       *       : await $`pnpm sst deploy`;
       *   }
       * }
       * ```
       *
       * You'll notice we are not passing in `--stage` to the SST commands. This is because the `SST_STAGE` environment variable is already set in
       * the build process.
       *
       * :::tip
       * You don't need to pass in `--stage` to the SST commands.
       * :::
       *
       * The build process is run inside an
       * [Amazon Linux 2](https://aws.amazon.com/amazon-linux-2/) machine based on
       * the `architecture` used.
       */
      workflow?(input: WorkflowInput): Promise<void>;
    };
  };
  /**
   * An async function that lets you define the resources in your app.
   *
   * :::note
   * You can use SST and Pulumi components only in the `run` function.
   * :::
   *
   * You can optionally return an object that'll be displayed as the output in the CLI.
   *
   * @example
   *
   * For example, here we return the name of the bucket we created.
   *
   * ```ts title="sst.config.ts"
   * async run() {
   *   const bucket = new sst.aws.Bucket("MyBucket");
   *
   *   return {
   *     bucket: bucket.name
   *   };
   * }
   * ```
   *
   * This will display the following in the CLI on `sst deploy` and `sst dev`.
   *
   * ```bash frame=\"none\"
   * bucket: bucket-jOaikGu4rla
   * ```
   *
   * These outputs are also written to a `.sst/outputs.json` file after every successful deploy.
   * It contains the above outputs in JSON.
   *
   * ```json title=".sst/outputs.json"
   * {"bucket": "bucket-jOaikGu4rla"}
   * ```
   */
  run(): Promise<Record<string, any> | void>;
}

/** @internal */
export function $config(input: Config): Config {
  return input;
}
