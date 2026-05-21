# OpenCode Desktop

The OpenCode Desktop app, built with Electron.

## Features 🆕

- **Custom Personalities**: Create, edit, and delete agent personalities with unique traits and system prompts
- **Auto-Learning Agents**: Each personality has a `learnings.md` file that evolves with every interaction
- **Multi-Project Workspaces**: Link multiple projects together for contextual understanding
- **Personality Management UI**: Manage all personalities from Settings page
- **Quick Selection**: Choose active personality and workspace directly from message input
- **Self-Learning Tools**: Agents can update their own learning files and personality profiles

## Development

```bash
npm install
npm run dev
```

## Build

Run the `build` script to build the app's JS assets, then `package` to
bundle the assets as an application. The resulting app will be in `dist/`.

```bash
npm run build && npm run package
```

## Personality System

### Creating a Personality

1. Go to **Settings** → **Personalities**
2. Click **Add Personality**
3. Fill in:
   - **Name**: Unique identifier for the personality
   - **Description**: Short description of when to use this personality
   - **Traits**: Comma-separated list of personality traits
   - **System Prompt**: Core instructions for the agent
   - **Temperature**: Creativity level (0-1)
   - **Model**: Preferred AI model provider

### Using Personalities

- **From Message Input**: Click the personality dropdown next to the model selector
- **Via Command**: Type `@personality-name` in your message
- **Default**: Last selected personality is remembered for the session

### Agent Self-Learning

Agents automatically learn from interactions:
- **Mistakes**: When corrected, agents record the lesson in `learnings.md`
- **Successes**: Patterns that work well are reinforced
- **Adaptation**: Agents can update their own traits based on user preferences

## Multi-Project Workspaces

### Creating a Workspace

1. Go to **Settings** → **Workspaces**
2. Click **Create Workspace**
3. Add multiple project folders to link them together

### Benefits

- **Shared Context**: Agent understands relationships between projects
- **Cross-Project Tasks**: Execute tasks that span multiple repositories
- **Unified Management**: All projects accessible from single interface

## IPC Handlers

The desktop app exposes the following IPC handlers for personality and workspace management:

### Personality Handlers
- `personality:list` - Get all personalities
- `personality:create` - Create new personality
- `personality:update` - Update existing personality
- `personality:delete` - Delete personality
- `personality:read` - Read specific personality details

### Workspace Handlers
- `workspace:create` - Create new workspace
- `workspace:list` - Get all workspaces
- `workspace:get` - Get specific workspace
- `workspace:update` - Update workspace
- `workspace:delete` - Delete workspace
- `workspace:addProject` - Add project to workspace
- `workspace:removeProject` - Remove project from workspace
- `workspace:getContext` - Get shared context for linked projects

## Tech Stack

- **Framework**: Electron
- **Frontend**: React + TypeScript
- **Runtime**: Node.js (no Bun dependency)
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
