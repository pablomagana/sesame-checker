# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Elgato Stream Deck plugin for Sesame HR time tracking. It provides physical buttons on a Stream Deck device to check in/out, pause work, and display current work time. The plugin communicates with the Sesame HR API (`https://back-eu1.sesametime.com/api/v3`) and includes a WebSocket client for real-time status updates from `wss://stream-eu1.sesametime.com`.

## Build & Development Commands

```bash
# Build the plugin once
npm run build

# Watch mode: builds and automatically restarts the plugin on changes
npm run watch

# Manual plugin restart using Elgato CLI
streamdeck restart com.pablo-magaa.sesamecheck

# Install the plugin for development
streamdeck install com.pablo-magaa.sesamecheck.sdPlugin
```

The build process uses Rollup to bundle TypeScript into `com.pablo-magaa.sesamecheck.sdPlugin/bin/plugin.js`. The watch command includes automatic plugin restart on build completion.

## Architecture

### Plugin Structure

The plugin follows the Elgato Stream Deck SDK architecture with a clear separation between actions, services, and the main plugin entry point:

- **Entry Point**: `src/plugin.ts` - Registers all actions, initializes WebSocket connection, handles global settings
- **Actions**: `src/actions/` - Each action is a `SingletonAction` class (one instance handles all button instances)
- **Services**: `src/services/` - Shared business logic for API and WebSocket communication

### Key Architectural Patterns

#### Singleton Actions with Multiple Instances

Each action class (`CheckIn`, `CheckOut`, `Pause`, `WorkTimer`) is a singleton, but must track multiple button instances that users can place on their Stream Deck. The pattern:

```typescript
export class CheckIn extends SingletonAction<CheckInSettings> {
    private readonly actionInstances: Set<any> = new Set();

    override async onWillAppear(ev: WillAppearEvent<CheckInSettings>): Promise<void> {
        this.actionInstances.add(ev.action);
        // ...
    }

    private updateAllButtons(): void {
        for (const action of this.actionInstances) {
            this.updateButtonState(action).catch(...);
        }
    }
}
```

**Important**: Do NOT use `private actions: Set<any>` as the property name - `actions` is already defined in the base class. Use `actionInstances` or similar.

#### Real-Time Updates via WebSocket

The architecture enables automatic button updates when work status changes on other devices:

1. **WebSocket Client** (`websocket-client.ts`): Manages connection to `wss://stream-eu1.sesametime.com` with automatic reconnection
2. **SesameAPI** (`sesame-api.ts`): Central service that listens to WebSocket events and notifies registered listeners
3. **Actions**: Register status change listeners that update all button instances when status changes

Status change flow:
```
Server WebSocket Event → WebSocketClient → SesameAPI.clearWorkStatusCache()
→ statusChangeListeners → Actions.updateAllButtons() → Button UI updates
```

#### Caching Strategy

**SesameAPI Work Status Cache**:
- 5-minute cache duration (`CACHE_DURATION_MS = 300000`)
- Cleared after any action (check-in, check-out, pause) via `clearWorkStatusCache()`
- Cleared when WebSocket receives `work_status_changed` event
- Prevents excessive API calls while maintaining fresh data after state changes

**Pause Action Work Breaks Cache**:
- Also 5-minute cache for available work breaks
- Preloaded on action appearance if authenticated
- Stored in both memory and global settings for property inspector access

### Authentication Flow

1. User enters credentials in any action's property inspector
2. `SesameAPI.login()` authenticates and stores token in global settings
3. Token persists across plugin restarts via `streamDeck.settings.getGlobalSettings()`
4. All subsequent API calls use `makeAuthenticatedRequest()` with Bearer token
5. WebSocket connects automatically after successful login with token as query parameter

### Work Status Values

The Sesame HR API returns one of three work statuses:
- `"online"` - User has checked in and is working
- `"paused"` - User is on a break (with an associated workBreakId)
- `"offline"` - User has checked out or never checked in

Actions enable/disable buttons based on these states:
- Check-In: Only enabled when `offline`
- Check-Out: Enabled when `online` or `paused`
- Pause: Only enabled when `online`

### Global Settings vs Action Settings

**Global Settings** (shared across all actions):
- `email`, `password`, `token`, `isAuthenticated`
- `availableWorkBreaks` (for property inspector access)
- Accessed via `streamDeck.settings.getGlobalSettings()`

**Action Settings** (per-button instance):
- Pause action: `selectedWorkBreakId`, `selectedWorkBreakName`
- Accessed via `ev.payload.settings` or `action.setSettings()`

## Important Implementation Details

### Property Name Conflicts

When adding private properties to action classes, avoid names that conflict with the base `SingletonAction` class:
- ❌ `private actions: Set<any>` (conflicts with base class)
- ✅ `private actionInstances: Set<any>` (no conflict)

### Async Plugin Initialization

The plugin initialization in `plugin.ts` must handle async operations carefully:

```typescript
// WebSocket initialization is async but plugin continues
try {
    await sesameAPI.initializeWebSocket();
} catch (error) {
    streamDeck.logger.error('WebSocket initialization error:', error);
}
```

### Work Timer Display Updates

The `WorkTimer` action updates every second without making API calls:
1. Fetches work status once on appearance via API
2. Stores `lastCheckInTime` from API response
3. Uses `setInterval` to calculate elapsed time locally
4. Only makes API calls when action appears or after user actions

This prevents rate limiting and excessive API usage.

### Pause Action Complexity

The Pause action is the most complex because:
1. Must load available work breaks from API
2. Stores work breaks in global settings for property inspector
3. Each button instance can have different selected break
4. Property inspector sends break selection back to plugin
5. Button title shows selected break name

The property inspector (`ui/pause-form.html`) communicates with the plugin via `sendToPlugin` events.

## WebSocket Integration

See `WEBSOCKET_SETUP.md` for detailed WebSocket configuration and server requirements.

Key points:
- WebSocket URL: `wss://stream-eu1.sesametime.com`
- Authentication: Token appended as query parameter
- Expected event format: `{ type: 'work_status_changed', data: { employeeId, workStatus, timestamp } }`
- Automatic reconnection every 5 seconds on disconnect
- Disconnects on logout

## Logging

Use `streamDeck.logger` for all logging:
```typescript
streamDeck.logger.info('Message');
streamDeck.logger.error('Error:', error);
```

Logs are written to:
- macOS: `~/Library/Logs/ElgatoStreamDeck/`
- Windows: `%APPDATA%\Elgato\StreamDeck\logs\`

The manifest has `"Debug": "enabled"` for Node.js debugging.

## Plugin Manifest

Located at `com.pablo-magaa.sesamecheck.sdPlugin/manifest.json`. Key configuration:
- UUID: `com.pablo-magaa.sesamecheck`
- Four actions with UUIDs: `worktimer`, `checkin`, `checkout`, `pause`
- Requires Node.js 20 (specified in manifest)
- Minimum Stream Deck software version: 6.5
- Supports macOS 12+ and Windows 10+

When adding new actions, update both the manifest and register in `src/plugin.ts`.

## TypeScript Configuration

- Targets Node.js 20 (`@tsconfig/node20`)
- ES2022 modules with Bundler resolution
- `noImplicitOverride: true` - Must use `override` keyword for action lifecycle methods
- Bundled as ES modules (Rollup emits `package.json` with `"type": "module"`)
