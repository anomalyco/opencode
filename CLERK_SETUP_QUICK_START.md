# Clerk Setup - Quick Start Guide

This is a quick reference for setting up Clerk authentication for Cerebras.

## 🚀 Step-by-Step Setup (5 minutes)

### 1. Create Clerk Account

1. Go to: **https://dashboard.clerk.com/sign-up**
2. Sign up with your email or GitHub account
3. Verify your email

### 2. Create Application

1. Click **"+ Add application"**
2. Fill in:
   - **Name**: `Cerebras`
   - **Application type**: Choose your auth methods:
     - ✅ Email/Password (recommended)
     - ✅ Google (optional)
     - ✅ GitHub (optional)
3. Click **"Create application"**

### 3. Get Your API Keys

After creating the app, you'll see your API keys immediately:

```
Publishable key: pk_test_xxxxxxxxxxxxxxxxxxxx
Secret key: sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Copy both keys!** You'll need them next.

### 4. Configure Cerebras

#### Option A: Environment Variables (Recommended)

Create a `.env` file in the project root:

```bash
# Navigate to project root
cd /Users/ari/GitHub/opencode

# Copy the example
cp .env.example .env

# Edit the file
nano .env
```

Add your keys:
```bash
CLERK_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
CLERK_SECRET_KEY=sk_test_YOUR_KEY_HERE
```

#### Option B: Shell Export (Temporary)

```bash
export CLERK_PUBLISHABLE_KEY="pk_test_YOUR_KEY_HERE"
export CLERK_SECRET_KEY="sk_test_YOUR_KEY_HERE"
```

### 5. Configure Device Flow (Important!)

Clerk doesn't have built-in device flow, so we need to configure a custom flow:

1. In Clerk Dashboard, go to **Configure** → **OAuth**
2. Scroll to **"OAuth Redirect URIs"**
3. Add:
   ```
   http://localhost:3000/auth/callback
   ```
4. Click **"Add"** then **"Save"**

### 6. Test It!

```bash
# Run Cerebras
bun run dev

# Or if you built it:
cerebras
```

You should see:
```
⚠  You are not logged in
? Would you like to login now? › (Y/n)
```

## ⚙️ Advanced Configuration

### Enable Additional OAuth Providers

In Clerk Dashboard:

1. Go to **User & Authentication** → **Social Connections**
2. Click on provider (e.g., Google, GitHub)
3. Click **"Enable"**
4. Follow provider-specific setup

### Configure Session Duration

1. Go to **Settings** → **Sessions**
2. Set **"Max lifetime"**: `30 days` (default)
3. Set **"Inactivity timeout"**: `7 days` (default)

### Production Setup

For production, switch to live keys:

1. In Clerk Dashboard, switch from **Development** to **Production**
2. Get new keys (they'll start with `pk_live_` and `sk_live_`)
3. Update your `.env`:

```bash
CLERK_PUBLISHABLE_KEY=pk_live_YOUR_LIVE_KEY
CLERK_SECRET_KEY=sk_live_YOUR_LIVE_KEY
NODE_ENV=production
```

## 🔧 Building the Auth Backend (Optional)

If you want to implement the full device authorization flow with a custom backend:

### Simple Node.js Backend

Create `auth-server.js`:

```javascript
import { Hono } from 'hono'
import { createClerkClient } from '@clerk/backend'

const app = new Hono()
const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY
})

// Store device codes in memory (use Redis in production)
const deviceCodes = new Map()

// Start device authorization
app.post('/auth/device/authorize', async (c) => {
  const deviceCode = generateCode(32)
  const userCode = generateUserCode() // e.g., "ABCD-1234"

  deviceCodes.set(deviceCode, {
    userCode,
    status: 'pending',
    createdAt: Date.now(),
  })

  return c.json({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: 'https://your-app.com/activate',
    verification_uri_complete: `https://your-app.com/activate?code=${userCode}`,
    expires_in: 900,
    interval: 5,
  })
})

// Poll for authorization
app.post('/auth/device/poll', async (c) => {
  const { device_code } = await c.req.json()
  const device = deviceCodes.get(device_code)

  if (!device) {
    return c.json({ error: 'invalid_grant' }, 400)
  }

  if (device.status === 'pending') {
    return c.json({ error: 'authorization_pending' }, 400)
  }

  if (device.status === 'authorized') {
    // Exchange for session
    return c.json({
      access_token: device.sessionToken,
      token_type: 'bearer',
      expires_in: 2592000, // 30 days
    })
  }
})

export default app
```

Deploy to:
- **Cloudflare Workers** (free tier)
- **AWS Lambda** (with API Gateway)
- **Vercel** (serverless functions)

## 📝 Next Steps

1. **Test the auth flow**: Run `cerebras auth login`
2. **Customize the UI**: Edit `src/auth/clerk.ts`
3. **Set up webhook**: For user event tracking (optional)
4. **Deploy backend**: Set up production auth server
5. **Create Homebrew tap**: For easy distribution

## 🆘 Troubleshooting

### "Clerk is not configured"

Check that:
- `.env` file exists in project root
- Keys are correctly formatted (no extra spaces)
- Terminal session has environment variables loaded

```bash
# Verify keys are loaded
echo $CLERK_PUBLISHABLE_KEY
echo $CLERK_SECRET_KEY
```

### "Invalid session"

Session might be expired. Clear and login again:

```bash
rm ~/.cerebras/session.json
cerebras auth login
```

### "Cannot find module '@clerk/backend'"

Install dependencies:

```bash
cd packages/cerebras
bun install
```

## 📚 Resources

- [Clerk Documentation](https://clerk.com/docs)
- [Clerk OAuth Guide](https://clerk.com/docs/authentication/social-connections/oauth)
- [Full Setup Guide](./AUTHENTICATION_SETUP.md)

## 🎉 You're Done!

Cerebras now has:
- ✅ User authentication via Clerk
- ✅ Secure session management
- ✅ Device authorization flow (CLI-friendly)
- ✅ Automatic session refresh
- ✅ Ready for production deployment

Run `cerebras` and start coding with AI! 🚀
