# OpenCode - Development Environment Tools

OpenCode is a collection of development environment tools that integrates with cloud platforms, providing enhanced productivity features for modern development workflows.

## Overview

- **Purpose**: Development environment tooling and integration
- **Focus**: Cloud platform integration and development workflows
- **Type**: TypeScript-based CLI and development tools

## Technology Stack

- **Language**: TypeScript
- **Cloud Platform**: SST (Serverless Stack)
- **Web Framework**: Next.js for web components
- **GitHub Integration**: GitHub Action SDK
- **API Management**: Stainless for API client generation
- **Editor Integration**: Vim mode support and configurations
- **Deployment**: Cloud platform deployment tools

## Architecture

Tool-based architecture with:
- **Core CLI**: Command-line interface for tool orchestration
- **SST Integration**: Serverless deployment and management
- **GitHub Actions**: CI/CD automation and workflow integration
- **API Layer**: Stainless-generated API clients
- **Editor Support**: Vim mode and editor integrations
- **Web Components**: Next.js-based UI components
- **Cloud Integration**: Deployment and management tools

## Development Commands

```bash
# Install dependencies
pnpm install

# Development server for web components
pnpm dev

# Build for production
pnpm build

# SST deployment (requires AWS credentials)
sst deploy

# Run CLI tools
npx opencode [command]

# Test GitHub actions
act -P ubuntu-latest=nektos/act-environments-ubuntu:18.04
```

## Key Features

1. **Cloud-Native Development**: SST integration for serverless apps
2. **GitHub Actions**: Automated workflows and CI/CD integration
3. **API Management**: Stainless for high-quality API clients
4. **Editor Support**: Vim mode and various editor integrations
5. **Web Components**: Reusable UI components with Next.js
6. **Cloud Deployment**: Automated deployment to major cloud platforms

## Project Structure

- `/src/` - TypeScript source code
- `/sst/` - Serverless Stack configurations
- `/github/` - GitHub Action workflows and SDK
- `/api/` - Stainless API definitions and clients
- `/editor/` - Editor integrations and configurations
- `/web/` - Next.js web components
- `/scripts/` - Build and deployment scripts

## Important Files

- `package.json` - Dependencies and build scripts
- `sst.json` - SST configuration
- `github/workflows/` - GitHub Action definitions
- `src/cli.ts` - CLI entry point
- `api/*.yaml` - OpenAPI specifications

## For AI Agents

When working with OpenCode codebase:
- Cloud-native with heavy focus on serverless architectures
- GitHub Actions integration for CI/CD automation
- SST used for AWS serverless deployments
- Stainless generates type-safe API clients
- Multiple editor integrations with Vim as primary
- Web components likely reusable across projects
- Look at SST configuration for understanding deployment patterns

## Development Notes

- Requires AWS credentials for full functionality
- GitHub Actions local testing with act
- SST provides full-stack serverless development
- Stainless requires API specifications (OpenAPI/Swagger)
- Modern TypeScript with strict type checking
- Cloud platform knowledge necessary for effective use

## Platform Integration

- Primary focus on AWS via SST
- GitHub for CI/CD and source control
- Various cloud APIs through Stainless clients
- Local development with live cloud integration
- Deployment automation and monitoring

## Configuration

- Environment variables for cloud credentials
- SST configuration for serverless settings
- GitHub Action secrets for automation
- API configuration files for client generation
- Editor-specific configuration files