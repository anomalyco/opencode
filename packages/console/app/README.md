# SolidStart

Everything you need to build a Solid project, powered by [`solid-start`](https://start.solidjs.com);

## Creating a project

```bash
# create a new project in the current directory
npm init solid@latest

# create a new project in my-app
npm init solid@latest my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

### GitHub API

The site reads the repo's stars, contributors and releases from the GitHub API on the server
(`src/lib/github-api.ts`). Without a token GitHub allows 60 calls an hour per IP, which a dev
machine can use up; then the pages show the last good data or the config fallbacks. Start the dev
server with your GitHub CLI token for 5,000 calls an hour:

```bash
GITHUB_TOKEN=$(gh auth token) bun run dev
```

Never commit a token. In dev the last good GitHub data is also kept in
`$TMPDIR/opencode-site-github/`, so a restart while rate limited still has it.

## Building

Solid apps are built with _presets_, which optimise your project for deployment to different environments.

By default, `npm run build` will generate a Node app that you can run with `npm start`. To use a different preset, add it to the `devDependencies` in `package.json` and specify in your `app.config.js`.

## This project was created with the [Solid CLI](https://github.com/solidjs-community/solid-cli)
