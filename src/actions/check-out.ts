import { action, KeyDownEvent, SingletonAction, WillAppearEvent, SendToPluginEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { sesameAPI } from "../services/sesame-api";

/**
 * Generate an SVG image with dark background and red rounded square icon (stop icon)
 */
function generateCheckOutSVG(enabled: boolean): string {
    const bgColor = "#1e293b"; // Dark blue-gray background
    const iconColor = enabled ? "#ef4444" : "#374151"; // Red when enabled, gray when disabled

    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
            <rect width="144" height="144" fill="${bgColor}"/>
            <rect x="47" y="47" width="50" height="50" rx="8" fill="${iconColor}"/>
        </svg>
    `)}`;
}

/**
 * Action for checking out from work
 */
@action({ UUID: "com.pablo-magaa.sesamecheck.checkout" })
export class CheckOut extends SingletonAction<CheckOutSettings> {
    private readonly actionInstances: Set<any> = new Set();
    private statusChangeListener: (() => void) | null = null;

    /**
     * Update button title based on current work status
     */
    override async onWillAppear(ev: WillAppearEvent<CheckOutSettings>): Promise<void> {
        this.actionInstances.add(ev.action);
        await this.updateButtonState(ev.action);

        // Register listener for status changes (only once for all instances)
        if (!this.statusChangeListener) {
            this.statusChangeListener = () => {
                streamDeck.logger.info('Check-out: Status change detected, updating all buttons');
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
                streamDeck.logger.error('Check-out: Error updating button:', error);
            });
        }
    }

    /**
     * Handle check-out action
     */
    override async onKeyDown(ev: KeyDownEvent<CheckOutSettings>): Promise<void> {
        try {
            streamDeck.logger.info('Check-out button pressed');

            // Ensure authentication (auto-login if needed)
            streamDeck.logger.info('Check-out: Starting authentication process');
            const isAuthenticated = await sesameAPI.performLogin();
            streamDeck.logger.info('Check-out: Authentication status:', isAuthenticated);

            if (!isAuthenticated) {
                streamDeck.logger.error('Check-out: Authentication failed');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }

            // Get current work status
            streamDeck.logger.info('Getting work status...');
            const workStatus = await sesameAPI.getWorkStatus();
            streamDeck.logger.info('Work status:', workStatus);

            if (!workStatus) {
                streamDeck.logger.error('No work status received');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }

            // Only allow check-out if online or paused
            if (workStatus.workStatus === 'offline') {
                streamDeck.logger.info('User is offline, cannot check out');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
                return;
            }

            // Perform check-out
            streamDeck.logger.info(`Attempting to check out employee: ${workStatus.employeeId}`);

            const result = await sesameAPI.checkOut(workStatus.employeeId);
            streamDeck.logger.info('Check-out result:', result);

            if (result) {
                streamDeck.logger.info('Check-out successful');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 1000);
            } else {
                streamDeck.logger.error('Check-out failed');
                setTimeout(async () => {
                    await this.updateButtonState(ev.action);
                }, 2000);
            }

        } catch (error) {
            streamDeck.logger.error('Check-out error:', error);
            setTimeout(async () => {
                await this.updateButtonState(ev.action);
            }, 2000);
        }
    }

    /**
     * Handle messages from property inspector (login form)
     */
    override async onSendToPlugin(ev: SendToPluginEvent<any, CheckOutSettings>): Promise<void> {
        const { payload } = ev;
        
        if (payload.event === 'login') {
            const { email, password } = payload;
            
            if (!email || !password) {
                streamDeck.logger.info('Check-out: Invalid credentials provided in login form');
                return;
            }

            streamDeck.logger.info('Check-out: Processing login from property inspector');
            
            const success = await sesameAPI.performLogin(email, password);
            
            if (success) {
                streamDeck.logger.info('Check-out: Login successful from property inspector');
                await this.updateButtonState(ev.action);
            } else {
                streamDeck.logger.error('Check-out: Login failed from property inspector');
            }
        } else if (payload.event === 'logout') {
            streamDeck.logger.info('Check-out: Processing logout from property inspector');
            await sesameAPI.logout();
            await this.updateButtonState(ev.action);
        }
    }

    /**
     * Update button state based on work status
     */
    private async updateButtonState(action: any): Promise<void> {
        try {
            streamDeck.logger.info('Check-out: Updating button state');
            const isAuthenticated = await sesameAPI.performLogin();

            if (!isAuthenticated) {
                streamDeck.logger.info('Check-out: No authentication for button update');
                const svgImage = generateCheckOutSVG(false);
                await action.setImage(svgImage);
                await action.setState(1); // Disabled state
                return;
            }

            const workStatus = await sesameAPI.getWorkStatus();

            if (!workStatus) {
                streamDeck.logger.error('Check-out: Error getting work status for button update');
                const svgImage = generateCheckOutSVG(false);
                await action.setImage(svgImage);
                await action.setState(1); // Disabled state
                return;
            }

            if (workStatus.workStatus === 'online' || workStatus.workStatus === 'paused') {
                streamDeck.logger.info('Check-out: Status online/paused, enabling Salir button');
                const svgImage = generateCheckOutSVG(true);
                await action.setImage(svgImage);
                await action.setState(0); // Enabled state
            } else {
                streamDeck.logger.info('Check-out: Status offline, disabling Salir button');
                const svgImage = generateCheckOutSVG(false);
                await action.setImage(svgImage);
                await action.setState(1); // Disabled state
            }

        } catch (error) {
            streamDeck.logger.error('Check-out: Error updating button state:', error);
            const svgImage = generateCheckOutSVG(false);
            await action.setImage(svgImage);
            await action.setState(1); // Disabled state
        }
    }
}

/**
 * Settings for {@link CheckOut}.
 */
type CheckOutSettings = {
    // No specific settings needed for now
};