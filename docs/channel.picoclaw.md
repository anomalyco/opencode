# Detailed Channel Implementation Plan: Matching Picoclaw Capabilities

Based on analysis of picoclaw's channel implementations, this plan outlines how to implement equivalent functionality in opencode for the requested platforms.

## Core Capabilities to Implement (Per Picoclaw Reference)

Each channel should implement these capability interfaces where applicable:
- `MessageSender` - Basic message sending (all channels)
- `MessageEditor` - Edit sent messages (Telegram, WhatsApp)
- `MessageDeleter` - Delete messages (Telegram, WhatsApp)
- `TypingCapable` - Show typing indicators (Telegram)
- `ReactionCapable` - Add/remove reactions (Telegram, WhatsApp)
- `MediaSender` - Send media attachments (Telegram, WhatsApp, Teams, Email)
- `StreamingCapable` - Progressive response updates (Telegram)
- `ToolFeedbackAnimator` - Progressive tool feedback (Telegram, WhatsApp)
- `PlaceholderCapable` - Send placeholder messages (Telegram)

## Files to Modify

### 1. Schema Enhancements
**Path:** `packages/opencode/src/channels/schema.ts`
- Update `ChannelType` literal union with all new types
- Enhance `ChannelInfo` schema to include platform-specific configuration fields:
  - For Telegram: `bot_token`, `chat_id`, `use_markdown_v2`
  - For WhatsApp: `webhook_url` (bridge endpoint), `phone_number_id`
  - For Email: `smtp_host`, `smtp_port`, `username`, `password`, `from_address`
  - For Calendar: `access_token`, `calendar_id`, `provider_type` (google/microsoft)
- Consider adding `capabilities` field to track what features each channel instance supports

### 2. Channel Service Updates
**Path:** `packages/opencode/src/channels/index.ts`
- Import all new transport capability modules
- Enhance the service to support capability-based dispatch (not just type-based)
- Update `send` function to handle platform-specific message formatting
- Add new service methods for advanced capabilities:
  - `editMessage(channelID, messageID, newMessage)`
  - `deleteMessage(channelID, messageID)`
  - `sendTyping(channelID)`
  - `sendReaction(channelID, messageID, emoji)`
  - `sendMedia(channelID, mediaData)`
  - `startStreaming(channelID)` / `updateStream(channelID, content)` / `endStream(channelID)`

### 3. Database Migration
**Path:** `packages/opencode/src/channels/migrations/002_enhance_channel_schema.sql`
- Add new columns to channel table for platform-specific config:
  - `bot_token` (encrypted)
  - `chat_id`
  - `email_config` (JSON or encrypted field)
  - `calendar_config` (JSON or encrypted field)
  - `capabilities` (text array or JSON)
- Update existing migrations if needed for backward compatibility

## Files to Add - Transport Implementations with Capabilities

### Teams Transport (`teams.ts`)
**Capabilities:** MessageSender, MediaSender (limited)
- Implement Teams webhook API with Adaptive Card support
- Handle @mentions and card actions
- Basic media attachment via Teams API limits
- Note: Primarily output-only like picoclaw's implementation

### Telegram Transport (`telegram.ts`)
**Full Picoclaw-equivalent capabilities:**
- **Core:** MessageSender, MessageEditor, MessageDeleter, TypingCapable, ReactionCapable, MediaSender, StreamingCapable, ToolFeedbackAnimator, PlaceholderCapable
- **Implementation Details:**
  - Use long polling for real-time message receiving (like picoclaw)
  - Handle MarkdownV2 and HTML formatting with automatic fallback
  - Implement message threading for forum topics
  - Add tool feedback animation system for progressive responses
  - Handle media: photos, voice, audio, video, documents with proper mime types
  - Implement inline keyboards and bot command support
  - Add message editing/deletion capabilities
  - Include typing action indicators (typing, uploading photo, etc.)
  - Implement draft-based streaming for progressive updates
  - Add group/forum mention detection and response filtering
  - Handle quote/reply with media preservation
  - Implement proper allowlist filtering for security

### WhatsApp Transport (`whatsapp.ts`)
**Capabilities:** MessageSender, MessageEditor, MessageDeleter, MediaSender, PlaceholderCapable
- Implement WebSocket bridge connection (like picoclaw)
- Handle simple JSON messaging over WebSocket
- Support media attachments (images, documents, etc.)
- Detect group vs. direct messages
- Implement basic templating system
- Add message editing/deletion where supported by bridge
- Include proper error handling and logging

### Email Transport (`email.ts`)
**Capabilities:** MessageSender, MediaSender (attachments)
- Support both Gmail (via API/SMTP) and Outlook (via Graph API/SMTP)
- Handle HTML email templating
- Process attachments with proper mime types
- Implement email threading/references
- Support CC/BCC and priority flags
- Handle inline images and rich content
- Consider implementing read receipts where applicable

### Google Calendar Transport (`google_calendar.ts`)
**Capabilities:** EventCreator, NotificationSender
- Implement Google Calendar API integration
- Handle event creation with reminders, attendees, etc.
- Support timezone-aware date/time handling
- Implement free/busy checking
- Handle recurring events
- Add notification/reminder creation capabilities
- Support calendar sharing and permissions

### Microsoft Outlook Transport (`microsoft_outlook.ts`)
**Capabilities:** EventCreator, NotificationSender
- Implement Microsoft Graph API integration
- Handle Outlook event creation with full feature parity to Google Calendar
- Support Outlook-specific features like meeting proposals
- Handle calendar sharing and delegate access
- Implement reminder/custom notification systems
- Support time zone handling and working hours

## Advanced Features to Consider (Post-MVP)

1. **Unified Message Interface:**
   - Create abstract message types that can be sent across channels
   - Handle channel-specific formatting automatically

2. **Conversation Context:**
   - Track conversation threads across platforms
   - Implement cross-platform message referencing

3. **Unified Media Handling:**
   - Standardize media upload/download across channels
   - Handle format conversion where needed

4. **Presence and Status:**
   - Implement user presence detection where available
   - Handle read receipts and delivery confirmations

5. **Administrative Controls:**
   - Channel moderation capabilities (where supported)
   - User management and permissions

## Implementation Priority

1. **Phase 1 - Basic Sending:** Teams, Telegram (basic), WhatsApp (basic), Email (basic)
2. **Phase 2 - Enhanced Capabilities:** Telegram (full feature set), WhatsApp (enhanced), Email (attachments)
3. **Phase 3 - Calendar Integrations:** Google Calendar, Outlook Calendar
4. **Phase 4 - Advanced Features:** Streaming, tool feedback, cross-channel capabilities

This plan ensures opencode's channel system can match picoclaw's functionality while maintaining consistency with the existing Effect-based architecture. Each transport implements the specific capabilities demonstrated in the picoclaw reference implementations.