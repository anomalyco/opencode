# Node.js releases data

[![npm version](https://img.shields.io/npm/v/node-releases.svg)](https://www.npmjs.com/package/node-releases)
[![License: MIT](https://img.shields.io/npm/l/node-releases.svg)](./LICENSE)

All data is located in `data` directory.

`data/processed` contains `envs.json` with node.js releases data preprocessed to be used by [Browserslist](https://github.com/ai/browserslist) and other projects. Each version in this file contains only necessary info: version, release date, LTS flag/name, and security flag.

`data/release-schedule` contains `release-schedule.json` with node.js releases date and end of life date.

## Installation

```bash
npm install node-releases
```

## Usage

```js
// CommonJS
const envs = require('node-releases/data/processed/envs.json');
const schedule = require('node-releases/data/release-schedule/release-schedule.json');

// ESM (Node.js 22+)
import envs from 'node-releases/data/processed/envs.json' with { type: 'json' };
import schedule from 'node-releases/data/release-schedule/release-schedule.json' with { type: 'json' };
```

## Releases

Releases are published automatically by a nightly GitHub Actions workflow whenever upstream Node.js release data changes. Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no long-lived tokens) and ships [provenance attestations](https://docs.npmjs.com/generating-provenance-statements).
