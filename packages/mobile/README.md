# OpenCode Mobile

<p align="center">
  <img src="../../packages/web/src/assets/logo-ornate-light.svg" alt="opencode logo" width="200">
</p>

<p align="center">AI coding agent for mobile - Chat with your codebase on the go</p>

---

## 📱 Overview

OpenCode Mobile is a React Native app that provides a mobile interface for the OpenCode AI coding agent. Chat with your codebase, browse files, and manage coding sessions directly from your phone or tablet.

### Key Features

- 💬 **Real-time Chat** with AI assistant
- 📁 **File Browser** with syntax highlighting
- 🔍 **Code Search** (text, files, symbols)
- 📱 **Session Management** (create, share, delete)
- 🌐 **Offline Support** with local caching
- 🎨 **Dark/Light Theme** support
- 🔄 **Real-time Sync** via Server-Sent Events

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ or Bun
- Expo CLI (`npm install -g @expo/cli`)
- iOS Simulator (macOS) or Android Emulator
- OpenCode server running locally

### Installation

```bash
# Install dependencies
bun install

# Start the development server
bun start

# Run on specific platforms
bun run ios      # iOS Simulator
bun run android  # Android Emulator
bun run web      # Web browser
```

### Server Setup

The mobile app connects to your local OpenCode server:

```bash
# In your project directory, start OpenCode server
opencode serve --hostname 0.0.0.0 --port 4096
```

Then configure the mobile app to connect to your machine's IP address (e.g., `192.168.1.100:4096`).

## 🏗️ Architecture

### Tech Stack

- **Framework**: React Native with Expo
- **Navigation**: Expo Router (file-based routing)
- **State Management**: TanStack Query + React Context
- **Database**: SQLite with Drizzle ORM
- **Styling**: React Native Unistyles
- **Real-time**: Server-Sent Events (SSE)

### Project Structure

```
src/
├── components/
│   ├── ui/
│   │   ├── primitives/     # Base design system components
│   │   └── base/          # Layout and navigation components
│   ├── molecules/         # Composed UI components
│   │   ├── chat/          # Chat-related components
│   │   ├── home/          # Home screen components
│   │   └── session/       # Session management components
│   └── pages/             # Screen components
├── db/
│   ├── schema/            # Database schema definitions
│   └── types.ts           # Database type definitions
├── hooks/                 # Custom React hooks
├── services/
│   ├── api/               # API client and services
│   │   ├── local/         # Local database operations
│   │   └── remote/        # Server API calls
│   └── *.ts               # Other services (chat, theme, etc.)
└── providers/             # React context providers

app/                       # Expo Router screens
├── (app)/                 # Main app screens
│   ├── _layout.tsx        # App layout with tabs
│   ├── index.tsx          # Home screen
│   ├── sessions.tsx       # Sessions list
│   └── chat/              # Chat screens
└── _layout.tsx            # Root layout
```

## 🗄️ Database Schema

The app uses SQLite with Drizzle ORM for local data storage and offline support:

### Core Tables

- **`sessions`** - Chat sessions (mirrors server Session.Info)
- **`messages`** - Chat messages (mirrors server MessageV2.Info)
- **`message_parts`** - Message components (mirrors server MessageV2.Part)
- **`providers`** - AI providers (cached from server)
- **`file_cache`** - Cached file contents for offline access
- **`sync_queue`** - Offline operations queue

### Database Commands

```bash
# Generate migrations
bun run db generate

# Push schema changes
bun run db push

# Open Drizzle Studio
bun run db studio
```

## 🔌 API Integration

### Server Endpoints

The mobile app integrates with these OpenCode server endpoints:

- **Sessions**: `GET/POST/DELETE /session`
- **Messages**: `GET/POST /session/:id/message`
- **Files**: `GET /file`, `GET /find`
- **Config**: `GET /config`, `GET /config/providers`
- **Real-time**: `GET /event` (SSE stream)

### Connection Management

```typescript
// Configure server connection
const config = {
  serverHostname: "192.168.1.100",
  serverPort: 4096,
  serverUrl: "http://192.168.1.100:4096",
}

// The app automatically handles:
// - Connection status monitoring
// - Offline queue management
// - Real-time event synchronization
```

## 📱 Screens & Navigation

### Main Screens

1. **Home** - Dashboard with recent sessions and quick actions
2. **Sessions** - List of all chat sessions with search/filter
3. **Chat** - Main chat interface with AI assistant
4. **Search** - Global search across files and code
5. **Settings** - App configuration and preferences

### Navigation Structure

```
TabNavigator (Bottom Tabs)
├── Home
├── Sessions
├── Search
└── Settings

StackNavigator (Modal/Push)
├── Chat Screen
├── File Viewer
├── Session Details
└── Connection Setup
```

## 🎨 Design System

### UI Components

The app uses a custom design system built with React Native Unistyles:

```typescript
// Example usage
<Box flex safeArea background="base">
  <Text size="lg" weight="semibold">Welcome</Text>
  <Button mode="brand" onPress={handlePress}>
    <Button.Text>Get Started</Button.Text>
  </Button>
</Box>
```

### Theme Support

- **Light/Dark Mode** - Automatic system detection
- **Color Tokens** - Consistent color palette
- **Typography Scale** - Responsive text sizing
- **Spacing System** - Consistent layout spacing

## 🔄 Offline Support

### Caching Strategy

- **Sessions & Messages** - Fully cached for offline access
- **File Contents** - LRU cache with configurable size limits
- **Search Results** - TTL-based cache (1 hour)

### Sync Process

1. **Online Mode** - Direct API calls with real-time updates
2. **Offline Mode** - Queue operations in `sync_queue`
3. **Reconnection** - Process queued operations with conflict resolution

## 🛠️ Development

### Available Scripts

```bash
# Development
bun start                    # Start Expo dev server
bun run ios                  # Run on iOS simulator
bun run android              # Run on Android emulator
bun run web                  # Run in web browser

# Database
bun run db generate          # Generate Drizzle migrations
bun run db push              # Push schema to database
bun run db studio            # Open Drizzle Studio

# Code Quality
bun run lint                 # Run ESLint
bun run typecheck            # Run TypeScript checks

# Builds
eas build --platform ios     # Build for iOS
eas build --platform android # Build for Android
```

### Environment Configuration

The app supports multiple environments via `EXPO_PUBLIC_ENV`:

- **dev** - Development builds
- **preview** - Internal testing builds
- **production** - App Store releases

### Build Profiles

```json
{
  "dev": {
    "developmentClient": true,
    "distribution": "internal"
  },
  "preview": {
    "distribution": "internal"
  },
  "production": {
    "autoIncrement": true
  }
}
```

## 📚 Documentation

### Additional Docs

- [**Mobile App Plan**](./MOBILE_APP_PLAN.md) - Detailed feature planning
- [**Component Patterns**](./COMPONENT_PATTERNS.md) - UI component guidelines
- [**Database Schema**](./DATABASE_SCHEMA.md) - Complete database documentation
- [**Streaming Optimizations**](./STREAMING_PERFORMANCE_OPTIMIZATIONS.md) - Performance notes
- [**UI Primitives**](./UI_PRIMITIVES.md) - Design system documentation

### API Documentation

The mobile app integrates with the OpenCode server API. See the main project documentation for complete API reference.

## 🤝 Contributing

### Development Setup

1. **Clone the repository**
2. **Install dependencies**: `bun install`
3. **Start OpenCode server**: `opencode serve --hostname 0.0.0.0`
4. **Start mobile app**: `bun start`
5. **Configure connection** in the app settings

### Code Style

- Use TypeScript for all new code
- Follow existing component patterns
- Use the design system components
- Add proper error handling and loading states
- Test on both iOS and Android

### Testing

```bash
# Run on different platforms
bun run ios      # Test iOS functionality
bun run android  # Test Android functionality
bun run web      # Test web compatibility
```

## 📄 License

This project is licensed under the MIT License - see the main project [LICENSE](../../LICENSE) file for details.

## 🔗 Links

- [OpenCode Main Project](https://github.com/sst/opencode)
- [OpenCode Website](https://opencode.ai)
- [Discord Community](https://opencode.ai/discord)
- [Documentation](https://opencode.ai/docs)

---

**Built with ❤️ by the OpenCode team**
