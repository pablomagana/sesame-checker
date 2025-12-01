import { action, KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, SendToPluginEvent } from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { sesameAPI, WorkStatusType, EmployeeCheck } from "../services/sesame-api";

/**
 * Generate an SVG image with black background and white text
 */
function generateTimerSVG(topText: string, timeText: string): string {
    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="144" height="144" xmlns="http://www.w3.org/2000/svg">
            <rect width="144" height="144" fill="#000000"/>
            <text x="72" y="45" font-family="Arial, sans-serif" font-size="16" fill="#FFFFFF" text-anchor="middle">${topText}</text>
            <text x="72" y="95" font-family="Arial, sans-serif" font-size="36" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${timeText}</text>
        </svg>
    `)}`;
}

/**
 * Action that displays current work time and opens Sesame HR web on click
 */
@action({ UUID: "com.pablo-magaa.sesamecheck.worktimer" })
export class WorkTimer extends SingletonAction<WorkTimerSettings> {
    private updateInterval: NodeJS.Timeout | null = null;
    private currentWorkSeconds: number = 0;
    private lastApiUpdateTime: number | null = null;
    private currentStatus: WorkStatusType | null = null;
    private currentPauseSeconds: number = 0;
    private readonly actionInstances: Set<any> = new Set();
    private statusChangeListener: (() => void) | null = null;

    /**
     * When the action appears, update work time once
     */
    override async onWillAppear(ev: WillAppearEvent<WorkTimerSettings>): Promise<void> {
        this.actionInstances.add(ev.action);
        await this.updateWorkTime(ev.action);

        // Register listener for status changes (only once for all instances)
        if (!this.statusChangeListener) {
            this.statusChangeListener = () => {
                streamDeck.logger.info('WorkTimer: Status change detected via WebSocket, updating all timers');
                this.updateAllTimers();
            };
            sesameAPI.addStatusChangeListener(this.statusChangeListener);
        }
    }

    /**
     * Update all timer instances when status changes
     */
    private updateAllTimers(): void {
        for (const action of this.actionInstances) {
            this.updateWorkTime(action).catch(error => {
                streamDeck.logger.error('WorkTimer: Error updating timer:', error);
            });
        }
    }

    /**
     * When the action disappears, stop the display timer
     */
    override onWillDisappear(ev: WillDisappearEvent<WorkTimerSettings>): void {
        this.actionInstances.delete(ev.action);
        this.stopDisplayTimer();
    }

    /**
     * When pressed, open Sesame HR website
     */
    override async onKeyDown(ev: KeyDownEvent<WorkTimerSettings>): Promise<void> {
        // Open Sesame HR website
        try {
            const { exec } = await import('child_process');
            exec('open https://app.sesametime.com/');
        } catch (error) {
            streamDeck.logger.error('Error opening website:', error);
        }
    }

    /**
     * Start the display timer to update time display every second (no API calls)
     */
    private startDisplayTimer(action: any): void {
        this.stopDisplayTimer(); // Clear any existing timer
        
        this.updateInterval = setInterval(() => {
            this.updateDisplayTime(action);
        }, 1000); // Update display every second
    }

    /**
     * Stop the display timer
     */
    private stopDisplayTimer(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * Update only the display time without making API calls.
     * Uses cached totals and status to refresh the display every second.
     */
    private updateDisplayTime(action: any): void {
        if (this.lastApiUpdateTime === null) {
            return;
        }

        if (this.currentStatus === 'paused') {
            const now = Date.now();
            const elapsedSeconds = Math.max(0, Math.floor((now - this.lastApiUpdateTime) / 1000));
            const totalPauseSeconds = this.currentPauseSeconds + elapsedSeconds;
            const formattedPause = sesameAPI.formatWorkTime(totalPauseSeconds);
            const svgPause = generateTimerSVG("En pausa", `☕ ${formattedPause}`);
            action.setImage(svgPause);
            return;
        }

        let totalWorkSeconds = this.currentWorkSeconds;
        if (this.currentStatus === 'online') {
            const now = Date.now();
            const elapsedSeconds = Math.max(0, Math.floor((now - this.lastApiUpdateTime) / 1000));
            totalWorkSeconds += elapsedSeconds;
        }

        const formattedTime = sesameAPI.formatWorkTime(totalWorkSeconds);
        const svgImage = generateTimerSVG("Hoy llevas", formattedTime);
        action.setImage(svgImage);
    }

    /**
     * Update the work time display (only called on load or after actions)
     */
    private async updateWorkTime(action: any): Promise<void> {
        try {
            // Ensure authentication (auto-login if needed)
            const isAuthenticated = await sesameAPI.performLogin();

            if (!isAuthenticated) {
                const svgImage = generateTimerSVG("No Auth", "--:--");
                await action.setImage(svgImage);
                this.stopDisplayTimer();
                return;
            }

            // Get current work status
            const workStatus = await sesameAPI.getWorkStatus();

            if (!workStatus) {
                const svgImage = generateTimerSVG("Error", "--:--");
                await action.setImage(svgImage);
                this.stopDisplayTimer();
                return;
            }

            streamDeck.logger.info(`WorkTimer: Current work status: ${workStatus.workStatus}`);

            // Clear any existing timer before recalculating
            this.stopDisplayTimer();

            const checks = await sesameAPI.getTodayChecks(workStatus.employeeId);

            if (!checks) {
                const svgImage = generateTimerSVG("Sin datos", "--:--");
                await action.setImage(svgImage);
                this.lastApiUpdateTime = null;
                this.currentStatus = workStatus.workStatus;
                this.currentPauseSeconds = 0;
                return;
            }

            const { workSeconds, pauseSeconds } = this.calculateDailyMetrics(checks, workStatus.workStatus);

            this.currentWorkSeconds = workSeconds;
            this.currentPauseSeconds = pauseSeconds;
            this.lastApiUpdateTime = Date.now();
            this.currentStatus = workStatus.workStatus;

            streamDeck.logger.info(`WorkTimer: workSeconds=${workSeconds}, pauseSeconds=${pauseSeconds}, status=${workStatus.workStatus}`);

            // Start timer for online or paused states
            if (workStatus.workStatus === 'online' || workStatus.workStatus === 'paused') {
                this.startDisplayTimer(action);
            }

            this.updateDisplayTime(action);

        } catch (error) {
            streamDeck.logger.error('Error updating work time:', error);
            const svgImage = generateTimerSVG("Error", "--:--");
            await action.setImage(svgImage);
            this.stopDisplayTimer();
        }
    }

    /**
     * Calculate total worked seconds and active pause seconds from today's checks.
     */
    private calculateDailyMetrics(checks: EmployeeCheck[], status: WorkStatusType): { workSeconds: number; pauseSeconds: number } {
        const now = Date.now();
        const workSeconds = this.calculateWorkSeconds(checks, status, now);
        const pauseSeconds = status === 'paused' ? this.calculateActivePauseSeconds(checks, now) : 0;
        return { workSeconds, pauseSeconds };
    }

    /**
     * Sum the worked seconds for all work checks.
     */
    private calculateWorkSeconds(checks: EmployeeCheck[], status: WorkStatusType, nowMillis: number): number {
        let total = 0;
        streamDeck.logger.info(`WorkTimer: Calculating work seconds for ${checks.length} checks. Status: ${status}`);
        
        for (const check of checks) {
            const checkType = typeof check.checkType === 'string' ? check.checkType.toLowerCase() : 'unknown';
            if (checkType !== 'work') {
                streamDeck.logger.info(`WorkTimer: Skipping check ${check.id} of type ${checkType}`);
                continue;
            }
            
            const duration = this.getWorkDurationSeconds(check, status, nowMillis);
            streamDeck.logger.info(`WorkTimer: Check ${check.id} duration: ${duration}s`);
            total += duration;
        }
        
        streamDeck.logger.info(`WorkTimer: Total calculated work seconds: ${total}`);
        return total;
    }

    /**
     * Calculate the duration in seconds for a single work check.
     */
    private getWorkDurationSeconds(check: EmployeeCheck, status: WorkStatusType, nowMillis: number): number {
        // 1. For closed checks, always prefer the server-provided accumulatedSeconds if available
        if (check.checkOut && typeof check.accumulatedSeconds === 'number' && check.accumulatedSeconds > 0) {
            return check.accumulatedSeconds;
        }

        const start = this.parseDate(check.checkIn?.date);
        if (!start) {
            return 0;
        }

        const end = check.checkOut?.date ? this.parseDate(check.checkOut.date) : null;
        
        // 2. Closed check fallback: calculate from dates
        if (end) {
            return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
        }

        // 3. Open check (active): calculate time elapsed since start
        // We calculate this if status is online, OR if we just want to know the current duration of an open check regardless of global status
        // (Usually open work checks imply online status, but let's be robust)
        if (!check.checkOut) {
             return Math.max(0, Math.floor((nowMillis - start.getTime()) / 1000));
        }

        return 0;
    }

    /**
     * Calculate seconds elapsed for the active pause (if any).
     */
    private calculateActivePauseSeconds(checks: EmployeeCheck[], nowMillis: number): number {
        const activePause = checks.find(check => {
            if (typeof check.checkType !== 'string' || check.checkType.toLowerCase() !== 'pause') {
                return false;
            }
            return !check.checkOut;
        });

        if (!activePause?.checkIn?.date) {
            return 0;
        }

        const pauseStart = this.parseDate(activePause.checkIn.date);
        if (!pauseStart) {
            return 0;
        }

        return Math.max(0, Math.floor((nowMillis - pauseStart.getTime()) / 1000));
    }

    /**
     * Parse a date string into a Date object, returning null on failure.
     */
    private parseDate(dateString?: string | null): Date | null {
        if (!dateString) {
            return null;
        }

        const parsed = new Date(dateString);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }


    /**
     * Refresh work time data (call after check-in, check-out, pause actions)
     */
    public async refreshWorkTime(action: any): Promise<void> {
        await this.updateWorkTime(action);
    }

    /**
     * Handle messages from property inspector (login form)
     */
    override async onSendToPlugin(ev: SendToPluginEvent<any, WorkTimerSettings>): Promise<void> {
        const { payload } = ev;
        
        if (payload.event === 'login') {
            const { email, password } = payload;
            
            if (!email || !password) {
                streamDeck.logger.info('Work-timer: Invalid credentials provided in login form');
                return;
            }

            streamDeck.logger.info('Work-timer: Processing login from property inspector');
            
            const success = await sesameAPI.performLogin(email, password);
            
            if (success) {
                streamDeck.logger.info('Work-timer: Login successful from property inspector');
                await this.updateWorkTime(ev.action);
            } else {
                streamDeck.logger.error('Work-timer: Login failed from property inspector');
            }
        } else if (payload.event === 'logout') {
            streamDeck.logger.info('Work-timer: Processing logout from property inspector');
            await sesameAPI.logout();
            await this.updateWorkTime(ev.action);
        }
    }
}

/**
 * Settings for {@link WorkTimer}.
 */
type WorkTimerSettings = {
    // No specific settings needed for now
};
