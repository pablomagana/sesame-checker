import { action, KeyDownEvent, SingletonAction, WillAppearEvent, SendToPluginEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { sesameAPI } from "../services/sesame-api";
import { showButtonError } from "../utils/error-display";

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
            if (!isAuthenticated) {
                await showButtonError(ev.action, sesameAPI.lastError || 'Auth failed', () => this.updateButtonState(ev.action));
                return;
            }

            const workStatus = await sesameAPI.getWorkStatus();
            if (!workStatus) {
                await showButtonError(ev.action, sesameAPI.lastError || 'Status error', () => this.updateButtonState(ev.action));
                return;
            }

            if (workStatus.workStatus === 'offline') {
                await this.updateButtonState(ev.action);
                return;
            }

            const result = await sesameAPI.checkOut(workStatus.employeeId);
            if (result) {
                setTimeout(() => { this.updateButtonState(ev.action).catch(() => {}); }, 1000);
            } else {
                await showButtonError(ev.action, sesameAPI.lastError || 'Check-out failed', () => this.updateButtonState(ev.action));
            }

        } catch (error) {
            await showButtonError(ev.action, 'Error', () => this.updateButtonState(ev.action));
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
                await (ev.action as any).sendToPropertyInspector({ event: 'loginResult', success: false, error: 'Enter email and password' });
                return;
            }

            const success = await sesameAPI.performLogin(email, password);
            await (ev.action as any).sendToPropertyInspector({ event: 'loginResult', success, error: sesameAPI.lastError });

            if (success) {
                await this.updateButtonState(ev.action);
            } else {
                await showButtonError(ev.action, sesameAPI.lastError || 'Login failed', () => this.updateButtonState(ev.action));
            }
        } else if (payload.event === 'logout') {
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