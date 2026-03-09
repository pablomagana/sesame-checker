# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Elgato Stream Deck plugin for Sesame HR time tracking. It provides physical buttons on a Stream Deck device to check in/out, pause work, and display current work time. The plugin communicates with the Sesame HR API and uses polling for real-time status updates.

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

The build process uses Rollup to bundle TypeScript into `com.pablo-magaa.sesamecheck.sdPlugin/bin/plugin.js`. The watch command includes automatic plugin restart on build completion. Sourcemaps are only emitted in watch mode.

## Architecture

### Plugin Structure

- **Entry Point**: `src/plugin.ts` - Registers all actions, initializes polling, handles global settings
- **Actions**: `src/actions/` - Each action is a `SingletonAction` class (one instance handles all button instances)
- **Services**: `src/services/sesame-api.ts` - Singleton `SesameAPI` class handling auth, API calls, caching, polling, and status change notifications

### Key Architectural Patterns

#### Singleton Actions with Multiple Instances

Each action class (`CheckIn`, `CheckOut`, `Pause`, `WorkTimer`) is a singleton, but must track multiple button instances that users can place on their Stream Deck:

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

#### Real-Time Updates via Polling

The architecture uses 30-second polling to detect status changes from other devices:

1. **SesameAPI** (`sesame-api.ts`): Polls `/security/me` every 30 seconds, compares against `lastKnownStatus`, and notifies registered listeners on change
2. **Actions**: Register status change listeners via `sesameAPI.addStatusChangeListener()` that update all button instances

Status change flow:
```
Poll (30s interval) → SesameAPI.checkForStatusChanges() → status differs?
→ clearWorkStatusCache() → statusChangeListeners → Actions.updateAllButtons()
```

Polling starts automatically after login and stops on logout.

#### Two API Base URLs

The plugin uses two different API endpoints:
- **Main API**: `https://back-eu1.sesametime.com/api/v3` - Auth, work status (`/security/me`), check-in/out, pause, work breaks, stats
- **Mobile API**: `https://back-mobile-eu1.sesametime.com/api/v3` - Employee checks (`/employees/{id}/checks`), requires extra headers (`RSRC: 31`, `Accept: application/json`)

`makeAuthenticatedRequest()` hits the main API; `makeAuthenticatedMobileRequest()` hits the mobile API.

#### Caching Strategy

**Work Status Cache** (30 seconds):
- `CACHE_DURATION_MS = 30000` - Short duration since polling happens every 30 seconds
- Cleared after any action (check-in, check-out, pause) via `clearWorkStatusCache()`
- Cleared when polling detects a status change

**Pause Action Work Breaks Cache** (5 minutes):
- `WORK_BREAKS_CACHE_DURATION = 300000`
- Preloaded on action appearance if authenticated
- Stored in both memory and global settings for property inspector access

#### SVG Button Rendering

All actions render button images as inline SVG data URIs (`data:image/svg+xml,...`). Each action has a `generate*SVG()` function:
- **CheckIn**: Green play triangle (enabled) / gray (disabled)
- **CheckOut**: Red rounded square (enabled) / gray (disabled)
- **Pause**: Orange pause bars or hamburger icon for food-related breaks (enabled) / gray (disabled)
- **WorkTimer**: Black background with white text showing time (`HH:MM`) and status label

Button enabled/disabled states are determined by `workStatus`: `"online"`, `"paused"`, or `"offline"`.

### Authentication Flow

1. User enters credentials in any action's property inspector
2. `SesameAPI.login()` authenticates via `POST /security/login` and stores token in global settings
3. Token persists across plugin restarts via `streamDeck.settings.getGlobalSettings()`
4. All API calls use `makeAuthenticatedRequest()` with Bearer token
5. Polling starts automatically after successful login

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
- `availableWorkBreaks`, `workBreaksLastUpdated` (for property inspector access)
- Accessed via `streamDeck.settings.getGlobalSettings()`

**Action Settings** (per-button instance):
- Pause action: `selectedWorkBreakId`, `selectedWorkBreakName`
- Accessed via `ev.payload.settings` or `action.setSettings()`

## Important Implementation Details

### Work Timer Time Calculation

The `WorkTimer` action calculates display time from today's actual checks, not a single timestamp:

1. Fetches today's checks via `getTodayChecks()` (mobile API)
2. `calculateDailyMetrics()` sums work seconds from all `"work"` type checks:
   - Closed checks: uses `accumulatedSeconds` from server, falling back to `checkIn`/`checkOut` date diff
   - Open checks: calculates elapsed time from `checkIn` to now
3. For paused state: also calculates active pause seconds from the open pause check
4. Uses `setInterval(1s)` to increment the display locally between API fetches
5. Only makes API calls on appearance or after status change events

### Pause Action Complexity

The Pause action is the most complex because:
1. Must load available work breaks from API
2. Stores work breaks in global settings for property inspector
3. Each button instance can have a different selected break
4. Property inspector sends break selection back to plugin via `sendToPlugin` events
5. Button icon changes based on break name (hamburger for food breaks, pause bars otherwise)

The property inspector (`ui/pause-form.html`) communicates with the plugin via `sendToPlugin` events.

### Property Inspector Forms

- `ui/login-form.html` - Used by CheckIn, CheckOut, and WorkTimer for authentication
- `ui/pause-form.html` - Used by Pause for both authentication and work break selection
- Communication via `sendToPlugin`/`sendToPropertyInspector` with event-based payloads

## Logging

Use `streamDeck.logger` for all logging:
```typescript
streamDeck.logger.info('Message');
streamDeck.logger.error('Error:', error);
```

Logs are written to:
- macOS: `~/Library/Logs/ElgatoStreamDeck/`
- Windows: `%APPDATA%\Elgato\StreamDeck\logs\`

The manifest has `"Debug": "enabled"` for Node.js debugging. Log level is set to `TRACE` in `plugin.ts`.

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
