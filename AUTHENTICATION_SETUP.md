# Cerebras Authentication Setup

This guide will help you set up authentication for Cerebras using Clerk.

## Overview

Cerebras requires authentication before use (similar to Claude Code). We use [Clerk](https://clerk.com) for user authentication and session management.

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│             │       │             │       │             │
│  CLI User   │──────▶│    Clerk    │──────▶│  Cerebras   │
│             │       │    OAuth    │       │   Backend   │
│             │       │             │       │   (AWS)     │
└─────────────┘       └─────────────┘       └─────────────┘
```

## Quick Start

### 1. Install Cerebras

**Using Homebrew (macOS/Linux):**
```bash
brew tap arihantchoudhary/cerebras
brew install cerebras
```

**Using install script:**
```bash
# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/arihantchoudhary/opencode/main/install | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/arihantchoudhary/opencode/main/install.ps1 | iex
```

**From source:**
```bash
git clone https://github.com/arihantchoudhary/opencode.git
cd opencode
bun install
bun run build
```

### 2. First Run

When you run `cerebras` for the first time, you'll be prompted to log in:

```bash
cerebras
```

You'll see:
```
⚠  You are not logged in

To use Cerebras, you need to authenticate.
Run: cerebras auth login

? Would you like to login now? › (Y/n)
```

## Setting Up Clerk (For Developers/Administrators)

If you're setting up Cerebras for your organization, follow these steps:

### 1. Create a Clerk Account

1. Go to [https://dashboard.clerk.com/sign-up](https://dashboard.clerk.com/sign-up)
2. Create an account (free tier available)

### 2. Create a Clerk Application

1. Click "Add Application"
2. Name: **Cerebras**
3. Select authentication methods:
   - **Email/Password** (recommended)
   - **Google** (optional but recommended)
   - **GitHub** (optional but recommended)
4. Click "Create Application"

### 3. Configure OAuth Settings

1. Go to **Configure** → **OAuth**
2. Enable **"Device Authorization Grant"** (for CLI authentication)
3. Add allowed redirect URIs:
   ```
   http://localhost:3000/auth/callback
   https://your-domain.com/auth/callback
   ```

### 4. Get API Keys

1. Go to **API Keys** tab
2. Copy the following:
   - **Publishable Key** (starts with `pk_test_` or `pk_live_`)
   - **Secret Key** (starts with `sk_test_` or `sk_live_`)

### 5. Configure Environment Variables

Create a `.env` file in the project root:

```bash
# Copy the example file
cp .env.example .env

# Edit with your Clerk keys
nano .env
```

Add your Clerk keys:
```bash
CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxx
```

### 6. (Optional) Set Up Custom Domain

For production, you can set up a custom domain for authentication:

1. In Clerk dashboard, go to **Configure** → **Domains**
2. Add your custom domain (e.g., `accounts.cerebras.ai`)
3. Follow DNS configuration instructions
4. Update `.env`:
   ```bash
   CLERK_FRONTEND_API=https://accounts.cerebras.ai
   ```

## AWS Backend Setup (Optional - Advanced)

For full control, you can set up a custom AWS backend. This is optional as Clerk can handle everything.

### Architecture

```
API Gateway → Lambda Functions → DynamoDB
     ↓
  Cognito/Clerk
```

### Required AWS Services

1. **API Gateway**: REST API for authentication endpoints
2. **Lambda**: Serverless functions for auth logic
3. **DynamoDB**: User sessions and workspace data
4. **Secrets Manager**: Store Clerk keys securely

### Endpoints

- `POST /auth/device/authorize` - Start device authorization
- `POST /auth/device/poll` - Poll for auth completion
- `POST /auth/token` - Exchange code for session token
- `GET /auth/verify` - Verify active session
- `POST /workspace/create` - Create user workspace

### Deployment

We provide AWS CDK infrastructure code (coming soon):

```bash
cd infrastructure
npm install
npm run deploy
```

## User Login Flow

### Flow Diagram

```
1. User runs: cerebras
   ↓
2. CLI checks: authenticated?
   ↓ (if no)
3. Prompt: "Would you like to login?"
   ↓
4. CLI calls: Clerk device flow
   ↓
5. CLI displays: verification URL + code
   ↓
6. User opens browser and logs in
   ↓
7. CLI polls Clerk for completion
   ↓
8. Session stored locally (encrypted)
   ↓
9. CLI starts normally
```

### Manual Login

```bash
# Login to Cerebras (default)
cerebras auth login

# Login to a specific AI provider
cerebras auth login --provider
```

### Logout

```bash
cerebras auth logout
```

### Check Login Status

```bash
cerebras auth list
```

## Security Features

### Credential Storage

- Credentials stored in `~/.cerebras/session.json`
- File permissions: `0600` (user-only access)
- Session tokens automatically refreshed
- Expires after 30 days of inactivity

### Session Management

- Sessions verified on each CLI run
- Expired sessions automatically cleared
- Device ID tracking for security auditing

### Environment Variables

For development, you can skip auth (not recommended for production):

```bash
export CEREBRAS_SKIP_AUTH=true
cerebras
```

## Troubleshooting

### "Clerk is not configured"

**Error:**
```
⛔ Clerk is not configured
Missing required environment variables:
  - CLERK_PUBLISHABLE_KEY
  - CLERK_SECRET_KEY
```

**Solution:**
1. Check that `.env` file exists
2. Verify Clerk keys are correct
3. Restart your terminal/shell

### "Session has expired"

**Error:**
```
⚠️  Your session has expired
Please login again: cerebras auth login
```

**Solution:**
```bash
cerebras auth login
```

### "Authentication timed out"

**Error:**
```
✖ Authentication timed out
```

**Solution:**
- Check your internet connection
- Verify the verification URL opened correctly
- Try again: `cerebras auth login`

## Development Mode

When developing Cerebras, you can run without authentication:

```bash
# Option 1: Environment variable
export CEREBRAS_SKIP_AUTH=true
bun run dev

# Option 2: .env file
echo "CEREBRAS_SKIP_AUTH=true" >> .env
bun run dev
```

## FAQs

### Q: Do I need to pay for Clerk?

**A:** Clerk has a generous free tier (10,000 monthly active users). For most use cases, the free tier is sufficient.

### Q: Can I use my own authentication system?

**A:** Yes! You can implement a custom authentication provider by:
1. Creating a new provider in `src/auth/`
2. Implementing the same interface as `ClerkAuthProvider`
3. Updating `src/middleware/auth.ts` to use your provider

### Q: Where are credentials stored?

**A:** Credentials are stored in:
- **macOS/Linux**: `~/.cerebras/session.json`
- **Windows**: `%USERPROFILE%\.cerebras\session.json`

### Q: How long do sessions last?

**A:** Sessions last 30 days by default. You can configure this in Clerk dashboard under **Settings** → **Sessions**.

### Q: Can I use Cerebras without internet?

**A:** No, authentication requires an internet connection. After logging in, some features may work offline, but the initial authentication requires connectivity.

## Next Steps

- [User Guide](./README.md)
- [Contributing](./CONTRIBUTING.md)
- [API Documentation](./docs/API.md)
- [Clerk Documentation](https://clerk.com/docs)

## Support

- GitHub Issues: [https://github.com/arihantchoudhary/opencode/issues](https://github.com/arihantchoudhary/opencode/issues)
- Discussions: [https://github.com/arihantchoudhary/opencode/discussions](https://github.com/arihantchoudhary/opencode/discussions)
