import { action, KeyDownEvent, SingletonAction, WillAppearEvent, SendToPluginEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { sesameAPI } from "../services/sesame-api";

/**
 * Generate an SVG image with dark background and green play icon
 */
function generateCheckInSVG(enabled: boolean): string {
    const bgColor = "#1e293b"; // Dark blue-gray background
    const iconColor = enabled ? "#22c55e" : "#374151"; // Green when enabled, gray when disabled

    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
            <rect width="144" height="144" fill="${bgColor}"/>
            <polygon points="50,35 50,109 105,72" fill="${iconColor}"/>
        </svg>
    `)}`;
}

/**
 * Action for checking in to work
 */
@action({ UUID: "com.pablo-magaa.sesamecheck.checkin" })
export class CheckIn extends SingletonAction<CheckInSettings> {
    private readonly actionInstances: Set<any> = new Set();
    private statusChangeListener: (() => void) | null = null;

    /**
     * Update button title based on current work status
     */
    override async onWillAppear(ev: WillAppearEvent<CheckInSettings>): Promise<void> {
        this.actionInstances.add(ev.action);
        await this.updateButtonState(ev.action);

        // Register listener for status changes (only once for all instances)
        if (!this.statusChangeListener) {
            this.statusChangeListener = () => {
                streamDeck.logger.info('Check-in: Status change detected, updating all buttons');
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
                streamDeck.logger.error('Check-in: Error updating button:', error);
            });
        }
    }

    /**
     * Handle check-in action
     */
    override async onKeyDown(ev: KeyDownEvent<CheckInSettings>): Promise<void> {
        try {
            // Ensure authentication (auto-login if needed)
            streamDeck.logger.info('Check-in: Starting authentication process');
            const isAuthenticated = await sesameAPI.performLogin();

            if (!isAuthenticated) {
                streamDeck.logger.error('Check-in: Authentication failed');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }
            streamDeck.logger.info('Check-in: Authentication successful');

            // Get current work status
            const workStatus = await sesameAPI.getWorkStatus();

            if (!workStatus) {
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }
            streamDeck.logger.info('Check-in: Work status:', JSON.stringify(workStatus));
            // Only allow check-in if offline
            if (workStatus.workStatus !== 'offline') {
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }

            // Perform check-in
            const result = await sesameAPI.checkIn(workStatus.employeeId);

            if (result) {
                streamDeck.logger.info('Check-in: Check-in successful');

                // Update button state after successful check-in
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 1000);
            } else {
                streamDeck.logger.error('Check-in: Check-in failed');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
            }

        } catch (error) {
            streamDeck.logger.error('Check-in error:', error);
            setTimeout(async () => {
                await this.updateButtonState(ev.action);
            }, 2000);
        }
    }

    /**
     * Handle messages from property inspector (login form)
     */
    override async onSendToPlugin(ev: SendToPluginEvent<any, CheckInSettings>): Promise<void> {
        const { payload } = ev;
        
        if (payload.event === 'login') {
            const { email, password } = payload;
            
            if (!email || !password) {
                streamDeck.logger.info('Check-in: Invalid credentials provided in login form');
                return;
            }

            streamDeck.logger.info('Check-in: Processing login from property inspector');
            
            const success = await sesameAPI.performLogin(email, password);
            
            if (success) {
                streamDeck.logger.info('Check-in: Login successful from property inspector');
                await this.updateButtonState(ev.action);
            } else {
                streamDeck.logger.error('Check-in: Login failed from property inspector');
            }
        } else if (payload.event === 'logout') {
            streamDeck.logger.info('Check-in: Processing logout from property inspector');
            await sesameAPI.logout();
            await this.updateButtonState(ev.action);
        }
    }

    /**
     * Update button state based on work status
     */
    private async updateButtonState(action: any): Promise<void> {
        try {
            streamDeck.logger.info('Check-in: Updating button state');
            const isAuthenticated = await sesameAPI.performLogin();

            if (!isAuthenticated) {
                streamDeck.logger.info('Check-in: No authentication for button update');
                const svgImage = generateCheckInSVG(false);
                await action.setImage(svgImage);
                await action.setState(1); // Disabled state
                return;
            }

            const workStatus = await sesameAPI.getWorkStatus();

            if (!workStatus) {
                streamDeck.logger.error('Check-in: Error getting work status for button update');
                const svgImage = generateCheckInSVG(false);
                await action.setImage(svgImage);
                await action.setState(1); // Disabled state
                return;
            }

            if (workStatus.workStatus === 'offline') {
                streamDeck.logger.info('Check-in: Status offline, enabling Entrar button');
                const svgImage = generateCheckInSVG(true);
                await action.setImage(svgImage);
                await action.setState(0); // Enabled state
            } else {
                streamDeck.logger.info('Check-in: Status online/paused, disabling Entrar button');
                const svgImage = generateCheckInSVG(false);
                await action.setImage(svgImage);
                await action.setState(1); // Disabled state
            }

        } catch (error) {
            streamDeck.logger.error('Check-in: Error updating button state:', error);
            const svgImage = generateCheckInSVG(false);
            await action.setImage(svgImage);
            await action.setState(1); // Disabled state
        }
    }
}

/**
 * Settings for {@link CheckIn}.
 */
type CheckInSettings = {
    // No specific settings needed for now
};
