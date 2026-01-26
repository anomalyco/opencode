# OpenCode Mobile

A React Native / Expo app for connecting to OpenCode servers from your phone.

## Features

- **Multiple Connection Types**: Connect via local network, tunnels (Cloudflare/ngrok), or cloud-hosted instances
- **Secure Authentication**: Biometric authentication (Face ID/Touch ID) support
- **Session Management**: View, create, and manage coding sessions
- **Real-time Chat**: Stream responses from your AI assistant
- **File Diff Viewer**: See what changes were made to your code

## Getting Started

### Prerequisites

- Node.js 18+
- Bun (recommended) or npm
- Expo Go app on your phone (for development)

### Installation

```bash
# From the monorepo root
cd packages/mobile
bun install

# Start the development server
bun start
```

### Connecting to OpenCode

1. Start OpenCode in server mode on your machine:

   ```bash
   OPENCODE_SERVER_PASSWORD=yourpassword opencode serve --hostname 0.0.0.0 --port 4096
   ```

2. Open the app and add a connection:
   - **Local Network**: Use your machine's local IP (e.g., `http://192.168.1.100:4096`)
   - **Tunnel**: Set up a Cloudflare Tunnel or ngrok and use the tunnel URL
   - **Cloud**: Connect to a hosted OpenCode instance

## Building for Production

### iOS

```bash
bun run ios
# or
eas build --platform ios
```

### Android

```bash
bun run android
# or
eas build --platform android
```

## Security

- Credentials are stored securely using `expo-secure-store` (iOS Keychain / Android Keystore)
- Optional biometric authentication for app access
- Optional biometric confirmation for sending messages
- All traffic should use HTTPS for non-local connections

## Architecture

```
packages/mobile/
├── app/                  # Expo Router screens
│   ├── (tabs)/          # Tab navigation
│   ├── session/         # Session screens
│   └── connection/      # Connection management
├── src/
│   ├── components/      # Reusable components
│   ├── hooks/           # Custom hooks
│   ├── lib/             # SDK client & types
│   └── stores/          # Zustand state stores
└── assets/              # App icons & images
```

## Contributing

This is part of the OpenCode monorepo. See the root README for contribution guidelines.
