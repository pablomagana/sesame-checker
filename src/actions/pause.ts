import { action, KeyDownEvent, SingletonAction, WillAppearEvent, SendToPluginEvent, PropertyInspectorDidAppearEvent, DidReceiveSettingsEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { sesameAPI, WorkBreak } from "../services/sesame-api";

/**
 * Generate an SVG image with pause icon (two orange bars) or hamburger icon for food breaks
 */
function generatePauseSVG(breakName: string, enabled: boolean): string {
    const bgColor = "#1e293b"; // Dark blue-gray background
    const iconColor = enabled ? "#f97316" : "#374151"; // Orange when enabled, gray when disabled

    // Check if it's a food-related break (comida, almuerzo, desayuno, cena, etc.)
    const isFoodBreak = breakName &&
        (breakName.toLowerCase().includes('comida') ||
         breakName.toLowerCase().includes('almuerzo') ||
         breakName.toLowerCase().includes('almuerzos') ||
         breakName.toLowerCase().includes('desayuno') ||
         breakName.toLowerCase().includes('cena') ||
         breakName.toLowerCase().includes('lunch') ||
         breakName.toLowerCase().includes('breakfast') ||
         breakName.toLowerCase().includes('dinner'));

    if (isFoodBreak) {
        // Hamburger icon
        return `data:image/svg+xml,${encodeURIComponent(`
            <svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
                <rect width="144" height="144" fill="${bgColor}"/>
                <!-- Top bun -->
                <ellipse cx="72" cy="45" rx="35" ry="8" fill="${iconColor}"/>
                <rect x="37" y="45" width="70" height="8" fill="${iconColor}"/>
                <!-- Cheese -->
                <rect x="40" y="55" width="64" height="6" fill="${iconColor}" opacity="0.8"/>
                <!-- Patty -->
                <rect x="37" y="63" width="70" height="10" fill="${iconColor}"/>
                <!-- Lettuce -->
                <rect x="40" y="75" width="64" height="6" fill="${iconColor}" opacity="0.7"/>
                <!-- Bottom bun -->
                <rect x="37" y="83" width="70" height="10" fill="${iconColor}"/>
                <ellipse cx="72" cy="93" rx="35" ry="8" fill="${iconColor}"/>
            </svg>
        `)}`;
    } else {
        // Pause icon (two vertical bars)
        return `data:image/svg+xml,${encodeURIComponent(`
            <svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
                <rect width="144" height="144" fill="${bgColor}"/>
                <rect x="47" y="42" width="18" height="60" rx="9" fill="${iconColor}"/>
                <rect x="79" y="42" width="18" height="60" rx="9" fill="${iconColor}"/>
            </svg>
        `)}`;
    }
}

/**
 * Action for pausing work with selectable break types
 */
@action({ UUID: "com.pablo-magaa.sesamecheck.pause" })
export class Pause extends SingletonAction<PauseSettings> {
    private readonly actionInstances: Set<any> = new Set();
    private statusChangeListener: (() => void) | null = null;
    private currentSettings: PauseSettings = {};
    private workBreaksCache: WorkBreak[] | null = null;
    private lastWorkBreaksFetch: number = 0;
    private readonly WORK_BREAKS_CACHE_DURATION = 300000; // 5 minutes cache

    constructor() {
        super();
        streamDeck.logger.info('Pause action constructed and ready');
    }

    /**
     * Update button title based on current work status
     */
    override async onWillAppear(ev: WillAppearEvent<PauseSettings>): Promise<void> {
        this.actionInstances.add(ev.action);
        this.currentSettings = ev.payload.settings || {};
        streamDeck.logger.info('Pause: onWillAppear - Current settings:', JSON.stringify(this.currentSettings));
        
        // If we have a saved break selection, log it
        if (this.currentSettings.selectedWorkBreakId && this.currentSettings.selectedWorkBreakName) {
            streamDeck.logger.info(`Pause: Found saved break selection: "${this.currentSettings.selectedWorkBreakName}" (${this.currentSettings.selectedWorkBreakId})`);
        }
        
        await this.updateButtonState(ev.action);
        
        // Preload work breaks in cache if authenticated (for faster PI loading)
        const isAuthenticated = await sesameAPI.isAuthenticated();
        if (isAuthenticated) {
            streamDeck.logger.info('Pause: Action loaded with valid token, preloading work breaks cache...');
            
            // Load work breaks silently in background to populate cache
            try {
                const workStatus = await sesameAPI.getWorkStatus();
                if (workStatus) {
                    const workBreaks = await sesameAPI.getAllWorkBreaks(workStatus.employeeId);
                    if (workBreaks && workBreaks.length > 0) {
                        this.workBreaksCache = workBreaks;
                        this.lastWorkBreaksFetch = Date.now();
                        streamDeck.logger.info(`Pause: Preloaded ${workBreaks.length} work breaks in cache`);
                    }
                }
            } catch (error) {
                streamDeck.logger.error('Pause: Error preloading work breaks:', error);
            }
        } else {
            streamDeck.logger.info('Pause: No valid token found on action load');
        }

        // Register listener for status changes (only once for all instances)
        if (!this.statusChangeListener) {
            this.statusChangeListener = () => {
                streamDeck.logger.info('Pause: Status change detected, updating all buttons');
                this.updateAllButtons();
            };
            sesameAPI.addStatusChangeListener(this.statusChangeListener);
        }
    }

    /**
     * Update all button instances
     */
    private updateAllButtons(): void {
        for (const action of this.actionInstances) {
            this.updateButtonState(action).catch(error => {
                streamDeck.logger.error('Pause: Error updating button:', error);
            });
        }
    }

    /**
     * Handle property inspector appearing - load work breaks if authenticated
     */
    override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<PauseSettings>): Promise<void> {
        streamDeck.logger.info('Pause: Property Inspector appeared, checking authentication...');
        
        // Check if user is authenticated
        const isAuthenticated = await sesameAPI.isAuthenticated();
        if (isAuthenticated) {
            streamDeck.logger.info('Pause: User is authenticated, loading work breaks automatically...');
            await this.loadWorkBreaks(ev.action);
        } else {
            streamDeck.logger.info('Pause: User not authenticated, work breaks will load after login');
        }
    }

    /**
     * Handle pause action
     */
    override async onKeyDown(ev: KeyDownEvent<PauseSettings>): Promise<void> {
        try {
            // Ensure authentication (auto-login if needed)
            streamDeck.logger.info('Pause: Starting authentication process');
            const isAuthenticated = await sesameAPI.performLogin();

            if (!isAuthenticated) {
                streamDeck.logger.error('Pause: Authentication failed');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }
            streamDeck.logger.info('Pause: Authentication successful');

            // Get current work status
            const workStatus = await sesameAPI.getWorkStatus();

            if (!workStatus) {
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }
            streamDeck.logger.info('Pause: Work status:', JSON.stringify(workStatus));

            // Only allow pause if online
            if (workStatus.workStatus !== 'online') {
                streamDeck.logger.info(`Pause: Cannot pause, status is ${workStatus.workStatus}`);
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }

            // Get selected work break from settings
            this.currentSettings = ev.payload.settings || {};
            const selectedBreakId = this.currentSettings.selectedWorkBreakId;

            if (!selectedBreakId) {
                streamDeck.logger.error('Pause: No work break selected in settings');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }

            // Perform pause
            streamDeck.logger.info(`Pause: Starting pause with break ID: ${selectedBreakId}`);

            const result = await sesameAPI.pause(workStatus.employeeId, selectedBreakId);

            if (result) {
                streamDeck.logger.info('Pause: Pause successful');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 1000);
            } else {
                streamDeck.logger.error('Pause: Pause failed');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
            }

        } catch (error) {
            streamDeck.logger.error('Pause error:', error);
            setTimeout(async () => {
                await this.updateButtonState(ev.action);
            }, 2000);
        }
    }

    /**
     * Handle messages from property inspector (login form and break selection)
     */
    override async onSendToPlugin(ev: SendToPluginEvent<any, PauseSettings>): Promise<void> {
        const { payload } = ev;
        
        streamDeck.logger.info('Pause: Received message from Property Inspector:', JSON.stringify(payload));
        
        if (payload.event === 'login') {
            const { email, password } = payload;
            
            if (!email || !password) {
                streamDeck.logger.info('Pause: Invalid credentials provided in login form');
                return;
            }

            streamDeck.logger.info('Pause: Processing login from property inspector');
            
            const success = await sesameAPI.performLogin(email, password);
            
            if (success) {
                streamDeck.logger.info('Pause: Login successful from property inspector');
                await this.updateButtonState(ev.action);
                
                // After successful login, load work breaks for the dropdown
                streamDeck.logger.info('Pause: Login successful, loading work breaks...');
                await this.loadWorkBreaks(ev.action);
            } else {
                streamDeck.logger.error('Pause: Login failed from property inspector');
            }
        } else if (payload.event === 'logout') {
            streamDeck.logger.info('Pause: Processing logout from property inspector');
            await sesameAPI.logout();
            await this.updateButtonState(ev.action);
        } else if (payload.event === 'loadWorkBreaks') {
            streamDeck.logger.info('Pause: Loading work breaks requested from property inspector');
            await this.loadWorkBreaks(ev.action);
        } else if (payload.event === 'selectWorkBreak') {
            const { workBreakId, workBreakName } = payload;
            streamDeck.logger.info(`Pause: Work break selected: ${workBreakId} (${workBreakName})`);
            streamDeck.logger.info('Pause: Full payload:', JSON.stringify(payload));
            streamDeck.logger.info(`Pause: Previous settings:`, JSON.stringify(this.currentSettings));
            
            // Update current settings in memory
            this.currentSettings = {
                ...this.currentSettings,
                selectedWorkBreakId: workBreakId,
                selectedWorkBreakName: workBreakName
            };
            
            streamDeck.logger.info(`Pause: Updated settings:`, JSON.stringify(this.currentSettings));
            
            // Save the selected work break to settings
            await ev.action.setSettings(this.currentSettings);
            streamDeck.logger.info(`Pause: Settings saved to action`);

            // Update button icon to show selected break immediately
            streamDeck.logger.info(`Pause: About to update button state with break: ${workBreakName}`);
            await this.updateButtonState(ev.action);
        } else if (payload.event === 'testMessage') {
            streamDeck.logger.info('Pause: Received test message from Property Inspector:', payload.message);
        } else {
            streamDeck.logger.warn('Pause: Unknown event from Property Inspector:', payload.event);
        }
    }

    /**
     * Handle settings changes from Property Inspector
     */
    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PauseSettings>): Promise<void> {
        streamDeck.logger.info('Pause: Settings received from Property Inspector:', JSON.stringify(ev.payload.settings));
        
        // Update current settings
        this.currentSettings = ev.payload.settings || {};

        // Update button icon based on settings
        if (this.currentSettings.selectedWorkBreakName && this.currentSettings.selectedWorkBreakId) {
            streamDeck.logger.info(`Pause: Updating button icon from settings: ${this.currentSettings.selectedWorkBreakName}`);
        } else {
            streamDeck.logger.info('Pause: No break selected in received settings');
        }
        await this.updateButtonState(ev.action);
    }

    /**
     * Load available work breaks and send them to property inspector
     */
    private async loadWorkBreaks(action: any): Promise<void> {
        try {
            streamDeck.logger.info('Pause: Starting loadWorkBreaks...');
            
            // Check cache first
            const now = Date.now();
            if (this.workBreaksCache && (now - this.lastWorkBreaksFetch) < this.WORK_BREAKS_CACHE_DURATION) {
                streamDeck.logger.info(`Pause: Using cached work breaks (${this.workBreaksCache.length} items)`);
                const payload = {
                    event: 'workBreaksLoaded',
                    workBreaks: this.workBreaksCache
                };
                // Try different ways to send to property inspector
                if (typeof action.sendToPropertyInspector === 'function') {
                    await action.sendToPropertyInspector(payload);
                } else {
                    streamDeck.logger.error('Pause: sendToPropertyInspector not available on action object');
                    // Try using streamDeck directly if possible
                    streamDeck.logger.info('Pause: Attempting alternative method to send data');
                }
                streamDeck.logger.info('Pause: Cached work breaks sent to property inspector');
                return;
            }
            
            const workStatus = await sesameAPI.getWorkStatus();
            if (!workStatus) {
                streamDeck.logger.error('Pause: Cannot load work breaks - no work status');
                return;
            }

            streamDeck.logger.info(`Pause: Got work status, employee ID: ${workStatus.employeeId}`);
            const workBreaks = await sesameAPI.getAllWorkBreaks(workStatus.employeeId);
            
            if (workBreaks && workBreaks.length > 0) {
                streamDeck.logger.info(`Pause: Successfully loaded ${workBreaks.length} work breaks`);
                
                // Cache the work breaks
                this.workBreaksCache = workBreaks;
                this.lastWorkBreaksFetch = now;
                streamDeck.logger.info('Pause: Work breaks cached for 5 minutes');
                
                // Log the work breaks being sent
                streamDeck.logger.info('Pause: Work breaks to send to Property Inspector:');
                workBreaks.forEach((wb, index) => {
                    streamDeck.logger.info(`  ${index + 1}. "${wb.name}" (ID: ${wb.id})`);
                });
                
                // Send work breaks to property inspector
                const payload = {
                    event: 'workBreaksLoaded',
                    workBreaks: workBreaks
                };
                streamDeck.logger.info('Pause: Storing work breaks in global settings');
                // Store work breaks in global settings for Property Inspector to access
                const globalSettings = await streamDeck.settings.getGlobalSettings();
                globalSettings.availableWorkBreaks = JSON.parse(JSON.stringify(workBreaks)); // Convert to JSON-compatible format
                globalSettings.workBreaksLastUpdated = now;
                await streamDeck.settings.setGlobalSettings(globalSettings);
                streamDeck.logger.info('Pause: Work breaks stored in global settings successfully');
            } else {
                streamDeck.logger.error('Pause: No work breaks found or failed to load');
                
                // Send empty array to property inspector
                const payload = {
                    event: 'workBreaksLoaded',
                    workBreaks: []
                };
                streamDeck.logger.info('Pause: Sending empty work breaks array to Property Inspector');
                // Try different ways to send to property inspector
                if (typeof action.sendToPropertyInspector === 'function') {
                    await action.sendToPropertyInspector(payload);
                } else {
                    streamDeck.logger.error('Pause: sendToPropertyInspector not available on action object');
                    // Try using streamDeck directly if possible
                    streamDeck.logger.info('Pause: Attempting alternative method to send data');
                }
            }
        } catch (error) {
            streamDeck.logger.error('Pause: Error loading work breaks:', error);
            
            // Send empty array to property inspector on error
            const payload = {
                event: 'workBreaksLoaded',
                workBreaks: []
            };
            streamDeck.logger.info('Pause: Sending empty work breaks array due to error');
            await action.sendToPropertyInspector(payload);
        }
    }

    /**
     * Update button state based on work status and selected break
     */
    private async updateButtonState(action: any, forceShowBreakName: boolean = false): Promise<void> {
        try {
            streamDeck.logger.info('Pause: Updating button state');

            // Use the current settings stored in memory
            const selectedBreakName = this.currentSettings.selectedWorkBreakName || '';
            const selectedBreakId = this.currentSettings.selectedWorkBreakId;

            streamDeck.logger.info(`Pause: Current settings - ID: ${selectedBreakId}, Name: ${selectedBreakName}`);

            const isAuthenticated = await sesameAPI.performLogin();

            if (!isAuthenticated) {
                streamDeck.logger.info('Pause: No authentication for button update');
                const svgImage = generatePauseSVG(selectedBreakName, false);
                await action.setImage(svgImage);
                return;
            }

            const workStatus = await sesameAPI.getWorkStatus();

            if (!workStatus) {
                streamDeck.logger.error('Pause: Error getting work status for button update');
                const svgImage = generatePauseSVG(selectedBreakName, false);
                await action.setImage(svgImage);
                return;
            }

            streamDeck.logger.info(`Pause: Work status received: ${workStatus.workStatus}`);

            // Determine if button should be enabled (only online status can pause)
            const isEnabled = workStatus.workStatus === 'online';

            // Generate SVG with appropriate icon
            const svgImage = generatePauseSVG(selectedBreakName, isEnabled);
            await action.setImage(svgImage);

            streamDeck.logger.info(`Pause: Button updated with icon (enabled: ${isEnabled}, break: ${selectedBreakName})`);

        } catch (error) {
            streamDeck.logger.error('Pause: Error updating button state:', error);
            const svgImage = generatePauseSVG('', false);
            await action.setImage(svgImage);
        }
    }
}

/**
 * Settings for {@link Pause}.
 */
type PauseSettings = {
    selectedWorkBreakId?: string;
    selectedWorkBreakName?: string;
};