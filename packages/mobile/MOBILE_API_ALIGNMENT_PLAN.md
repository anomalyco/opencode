# Mobile App API Alignment Plan

## Overview

Align the mobile app's message handling with the TUI implementation to ensure complete data access and consistent behavior across platforms.

## Problem Analysis

### Current Issues

1. **Incomplete Type Definitions**: Mobile app's TypeScript interfaces only capture a subset of the API data
2. **Missing Critical Data**: Tool states, file information, costs, tokens, error details, and metadata are not accessible
3. **Unnecessary API Calls**: Individual message fetching in `transformRemoteToLocalMessage` is redundant
4. **Data Loss**: Rich information available from the API is being ignored due to incomplete types

### Root Cause

The mobile app uses the same API endpoint (`/session/{id}/message`) as the TUI but with severely limited TypeScript interfaces that don't match the actual API schema.

## Current vs Target State

### Mobile App (Current)

```typescript
interface MessageResponse {
  info: {
    id: string
    role: "user" | "assistant"
    sessionID: string
    time: { created: number; completed?: number }
  }
  parts: {
    id: string
    type: string
    text?: string
    synthetic?: boolean
    messageID: string
    sessionID: string
    time?: { start: number; end: number }
  }[]
}
```

### Target (Complete API Schema)

```typescript
interface SessionMessagesResponse {
  info: Message // Complete message with all fields
  parts: Part[] // Complete parts with all type-specific fields
}
```

## Implementation Plan

### Phase 1: Type System Update

- [ ] Create complete type definitions matching the API schema
- [ ] Update `MessageResponse` → `SessionMessagesResponse`
- [ ] Add all message fields (error, system, modelID, providerID, mode, path, cost, tokens)
- [ ] Add all part types with their specific fields (tool state, file info, etc.)
- [ ] Update import/export statements

### Phase 2: Remove Redundant Logic

- [ ] Remove individual message fetching from `transformRemoteToLocalMessage`
- [ ] Revert `transformRemoteToLocalMessage` to synchronous function
- [ ] Remove the API client import and async logic added recently
- [ ] Update `syncSingleMessage` to handle synchronous transformation

### Phase 3: Sync Logic Enhancement

- [ ] Update `transformRemoteToLocalMessage` to handle complete message data
- [ ] Update `transformRemoteToLocalPart` to handle all part types
- [ ] Ensure all new fields are properly mapped to local database schema
- [ ] Add proper error handling for new data fields

### Phase 4: Rendering Improvements

- [ ] Update part renderers to use new data fields
- [ ] Enhance tool status indicators with complete state information
- [ ] Add support for new part types (step-start, step-finish, snapshot, patch)
- [ ] Improve file part rendering with complete metadata
- [ ] Add cost and token information display where appropriate

### Phase 5: Testing & Validation

- [ ] Test with various message types and tool calls
- [ ] Verify all data is properly synced to local database
- [ ] Ensure rendering works correctly with complete data
- [ ] Compare behavior with TUI to ensure consistency

## Architecture Benefits

### Part-Based Rendering Advantages

- **Granular Control**: Each part is an independent UI component
- **Interactive Tools**: Tool calls can show real-time status updates
- **Flexible Layout**: Parts can be styled and positioned independently
- **Better UX**: Users see immediate feedback for each operation
- **Streaming Support**: Parts can be updated individually during streaming

### Data Completeness Benefits

- **Rich Tool Information**: Access to tool inputs, outputs, metadata, and errors
- **File Handling**: Complete file information with sources and metadata
- **Cost Tracking**: Token usage and cost information for analytics
- **Error Handling**: Detailed error information for better debugging
- **Metadata Access**: System prompts, modes, and configuration data

## Technical Details

### API Endpoint Usage

- **Endpoint**: `/session/{id}/message` (same as TUI)
- **Response**: Complete `SessionMessagesResponse[]` with full data
- **No Changes**: API usage remains the same, only type definitions change

### Database Schema

- Current local database schema should accommodate most new fields
- May need minor updates for new part types or message fields
- Existing sync logic will handle additional data automatically

### Backward Compatibility

- Changes are additive (new fields are optional)
- Existing functionality will continue to work
- Enhanced features will be available immediately

## Success Criteria

1. Mobile app receives complete data from API (same as TUI)
2. All part types render correctly with full information
3. Tool calls show complete state and metadata
4. File parts display with proper source information
5. Cost and token information is accessible
6. No redundant API calls for individual messages
7. Sync performance is maintained or improved

## Risk Mitigation

- **Type Safety**: Use strict TypeScript interfaces to prevent runtime errors
- **Gradual Rollout**: Update types first, then enhance rendering incrementally
- **Fallback Handling**: Ensure graceful degradation for missing optional fields
- **Testing**: Comprehensive testing with various message and part types

## Timeline

- **Phase 1**: 1-2 hours (Type definitions)
- **Phase 2**: 30 minutes (Remove redundant logic)
- **Phase 3**: 1 hour (Sync logic updates)
- **Phase 4**: 2-3 hours (Rendering improvements)
- **Phase 5**: 1 hour (Testing and validation)

**Total Estimated Time**: 5-7 hours

## Next Steps

1. Start with Phase 1: Update type definitions in `messages.ts`
2. Test basic functionality with new types
3. Proceed through phases incrementally
4. Validate each phase before moving to the next
