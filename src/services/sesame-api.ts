import streamDeck from "@elgato/streamdeck";

/**
 * Sesame HR API service for handling authentication and API calls
 */
// Global settings interface
interface GlobalPluginSettings {
    email?: string;
    password?: string;
    token?: string;
    isAuthenticated?: boolean;
    [key: string]: any; // Index signature for JsonObject compatibility
}

export class SesameAPI {
    private static readonly BASE_URL = 'https://back-eu1.sesametime.com/api/v3';
    private static readonly MOBILE_BASE_URL = 'https://back-mobile-eu1.sesametime.com/api/v3';
    private static readonly LOGIN_ENDPOINT = '/security/login';

    private token: string | null = null;
    private workStatusCache: WorkStatus | null = null;
    private lastWorkStatusFetch: number = 0;
    private readonly CACHE_DURATION_MS = 30000; // Cache for 30 seconds (for polling)
    private readonly statusChangeListeners: Array<() => void> = [];
    private pollingInterval: NodeJS.Timeout | null = null;
    private readonly POLLING_INTERVAL_MS = 30000; // Poll every 30 seconds
    private lastKnownStatus: WorkStatusType | null = null;

    /**
     * Authenticate with Sesame HR API and store credentials globally
     */
    async login(email: string, password: string): Promise<boolean> {
        try {
            streamDeck.logger.info('Starting login process for email:', email);
            const response = await fetch(`${SesameAPI.BASE_URL}${SesameAPI.LOGIN_ENDPOINT}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password })
            });

            if (!response.ok) {
                streamDeck.logger.error(`Authentication failed: ${response.status} ${response.statusText}`);
                throw new Error(`Authentication failed: ${response.statusText}`);
            }

            streamDeck.logger.info('Authentication response status:', response.status);
            const response_data: any = await response.json();

            // Extract token from response.data
            this.token = response_data.data;
            streamDeck.logger.info('Token received and stored:', this.token ? 'YES' : 'NO');

            // Save credentials and token to global settings
            await streamDeck.settings.setGlobalSettings({
                email,
                password, // Note: In production, consider encrypting this
                token: this.token,
                isAuthenticated: true
            });

            streamDeck.logger.info('Credentials saved to global settings');

            // Start polling after successful login
            this.startPolling();

            return true;
        } catch (error) {
            streamDeck.logger.error('Login error:', error);
            return false;
        }
    }

    /**
     * Get authentication token
     */
    async getToken(): Promise<string | null> {
        if (this.token) {
            return this.token;
        }

        // Try to get token from global settings
        const settings = await streamDeck.settings.getGlobalSettings<GlobalPluginSettings>();
        if (settings.token) {
            this.token = settings.token;
            return this.token;
        }

        return null;
    }

    /**
     * Check if user is authenticated
     */
    async isAuthenticated(): Promise<boolean> {
        const token = await this.getToken();
        return token !== null;
    }

    /**
     * Try to automatically login using stored credentials
     */
    private async autoLogin(): Promise<boolean> {
        const settings = await streamDeck.settings.getGlobalSettings<GlobalPluginSettings>();

        if (settings.email && settings.password) {
            streamDeck.logger.info('Auto-login: Found stored credentials, attempting login...');
            return await this.login(settings.email, settings.password);
        }

        return false;
    }

    /**
     * Perform login (auto or manual) - ensures authentication before any operation
     */
    async performLogin(email?: string, password?: string): Promise<boolean> {
        // If email and password provided, do manual login
        if (email && password) {
            return await this.login(email, password);
        }

        // Check if already authenticated
        const token = await this.getToken();
        if (token) {
            streamDeck.logger.info('Already authenticated with token');
            return true;
        }

        // Try auto-login
        streamDeck.logger.info('Not authenticated, attempting auto-login...');
        return await this.autoLogin();
    }

    /**
     * Clear authentication
     */
    async logout(): Promise<void> {
        this.token = null;
        await streamDeck.settings.setGlobalSettings({
            email: undefined,
            password: undefined,
            token: undefined,
            isAuthenticated: false
        });

        // Stop polling on logout
        this.stopPolling();

        streamDeck.logger.info('User logged out and global settings cleared');
    }

    /**
     * Centralized login function that handles both manual and automatic login
     */
    async ensureAuthenticated(): Promise<boolean> {
        return await this.performLogin();
    }

    /**
     * Make authenticated API call
     */
    private async makeAuthenticatedRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const token = await this.getToken();

        if (!token) {
            throw new Error('Not authenticated');
        }

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`, // Assuming Bearer token format
            ...options.headers
        };

        const url = `${SesameAPI.BASE_URL}${endpoint}`;
        const requestOptions = {
            ...options,
            headers
        };

        streamDeck.logger.info(`API Request: ${options.method || 'GET'} ${url}`);
        streamDeck.logger.info(`API Request Headers:`, JSON.stringify(headers));

        if (options.body) {
            streamDeck.logger.info(`API Request Body:`, options.body);
        }

        return fetch(url, requestOptions);
    }

    /**
     * Make authenticated request against the mobile API base.
     */
    private async makeAuthenticatedMobileRequest(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const token = await this.getToken();

        if (!token) {
            throw new Error('Not authenticated');
        }

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'RSRC': '31',
            ...options.headers
        };

        const url = `${SesameAPI.MOBILE_BASE_URL}${endpoint}`;
        const requestOptions = {
            ...options,
            headers
        };

        streamDeck.logger.info(`Mobile API Request: ${options.method || 'GET'} ${url}`);
        streamDeck.logger.info(`Mobile API Request Headers:`, JSON.stringify(headers));

        if (options.body) {
            streamDeck.logger.info(`Mobile API Request Body:`, options.body);
        }

        return fetch(url, requestOptions);
    }

    /**
     * Format a Date object into YYYY-MM-DD using the local timezone.
     */
    private formatDate(date: Date): string {
        return new Intl.DateTimeFormat('en-CA').format(date);
    }

    /**
     * Retrieve daily computed hour stats for a specific date range.
     */
    async getDailyComputedHourStats(employeeId: string, from: string, to: string): Promise<DailyComputedHourStat | null> {
        try {
            const endpoint = `/employees/${employeeId}/daily-computed-hour-stats?from=${from}&to=${to}`;
            streamDeck.logger.info(`Fetching daily stats for employee ${employeeId} from ${from} to ${to}`);
            const response = await this.makeAuthenticatedRequest(endpoint);

            if (!response.ok) {
                const errorText = await response.text();
                streamDeck.logger.error(`Daily stats failed: ${response.status} ${response.statusText} - ${errorText}`);
                throw new Error(`Failed to get daily stats: ${response.statusText} - ${errorText}`);
            }

            const payload = await response.json() as DailyComputedHourStatsResponse;
            let stats: DailyComputedHourStat | null = null;

            if (Array.isArray(payload.data)) {
                stats = payload.data.find(item => item.date === from) ?? payload.data[0] ?? null;
            } else if (payload.data) {
                stats = payload.data;
            }

            if (!stats) {
                streamDeck.logger.warn('Daily stats response missing data for requested date');
                return null;
            }

            streamDeck.logger.info(`Daily stats retrieved: workedSeconds=${stats.workedSeconds}, secondsToWork=${stats.secondsToWork}`);
            return stats;
        } catch (error) {
            streamDeck.logger.error('Error fetching daily stats:', error);
            return null;
        }
    }

    /**
     * Retrieve employee statistics for a specific date range.
     */
    async getEmployeeStatistics(employeeId: string, from: string, to: string): Promise<EmployeeStatistics | null> {
        try {
            streamDeck.logger.info(`Fetching statistics for employee ${employeeId} from ${from} to ${to}`);
            const response = await this.makeAuthenticatedRequest(`/employees-statistics`, {
                method: 'POST',
                body: JSON.stringify({
                    employeeIds: [employeeId],
                    from,
                    to
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                streamDeck.logger.error(`Employee statistics failed: ${response.status} ${response.statusText} - ${errorText}`);
                throw new Error(`Failed to get employee statistics: ${response.statusText} - ${errorText}`);
            }

            const payload = await response.json() as EmployeeStatisticsResponse;
            if (!payload.data) {
                streamDeck.logger.warn('Employee statistics response missing data field');
                return null;
            }

            streamDeck.logger.info(`Employee statistics retrieved with secondsWorked=${payload.data.secondsWorked} and secondsToWork=${payload.data.secondsToWork}`);
            return payload.data;
        } catch (error) {
            streamDeck.logger.error('Error fetching employee statistics:', error);
            return null;
        }
    }

    /**
     * Convenience helper to retrieve employee statistics for today.
     */
    async getTodayStatistics(employeeId: string): Promise<EmployeeStatistics | null> {
        const today = this.formatDate(new Date());
        return await this.getEmployeeStatistics(employeeId, today, today);
    }

    /**
     * Convenience helper to retrieve daily computed stats for today.
     */
    async getTodayDailyStats(employeeId: string): Promise<DailyComputedHourStat | null> {
        const today = this.formatDate(new Date());
        return await this.getDailyComputedHourStats(employeeId, today, today);
    }

    /**
     * Retrieve all checks for an employee within a date range (mobile API).
     */
    async getDailyChecks(employeeId: string, from: string, to: string): Promise<EmployeeCheck[] | null> {
        try {
            const endpoint = `/employees/${employeeId}/checks?from=${from}&to=${to}`;
            streamDeck.logger.info(`Fetching checks for employee ${employeeId} from ${from} to ${to}`);
            const response = await this.makeAuthenticatedMobileRequest(endpoint);

            if (!response.ok) {
                const errorText = await response.text();
                streamDeck.logger.error(`Checks request failed: ${response.status} ${response.statusText} - ${errorText}`);
                throw new Error(`Failed to get checks: ${response.statusText} - ${errorText}`);
            }

            const payload = await response.json() as EmployeeChecksResponse;
            streamDeck.logger.info(`Checks retrieved count=${payload.data.length}`);
            return payload.data;
        } catch (error) {
            streamDeck.logger.error('Error fetching daily checks:', error);
            return null;
        }
    }

    /**
     * Convenience helper to retrieve today's checks.
     */
    async getTodayChecks(employeeId: string): Promise<EmployeeCheck[] | null> {
        const today = this.formatDate(new Date());
        return await this.getDailyChecks(employeeId, today, today);
    }

    /**
     * Get current user status and work information (with caching)
     */
    async getWorkStatus(): Promise<WorkStatus | null> {
        const now = Date.now();

        // Return cached data if still fresh
        if (this.workStatusCache && (now - this.lastWorkStatusFetch) < this.CACHE_DURATION_MS) {
            streamDeck.logger.info('Returning cached work status:', JSON.stringify(this.workStatusCache));
            return this.workStatusCache;
        }

        try {
            streamDeck.logger.info('Fetching fresh work status from /security/me');
            const response = await this.makeAuthenticatedRequest('/security/me');

            if (!response.ok) {
                const errorText = await response.text();
                streamDeck.logger.error(`Work status error response: ${errorText}`);
                throw new Error(`Failed to get work status: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data: any = await response.json();
            streamDeck.logger.info('ESTAMOS:', JSON.stringify(data.data[0].workStatus));

            const workStatus = {
                workStatus: data.data[0].workStatus, // 'online', 'paused', 'offline'
                lastCheck: data.data[0].lastCheck,
                employeeId: data.data[0].id // Employee ID from the 'id' field
            };

            // Update cache
            this.workStatusCache = workStatus;
            this.lastWorkStatusFetch = now;

            streamDeck.logger.info('Cached fresh work status:', JSON.stringify(workStatus));

            return workStatus;
        } catch (error) {
            streamDeck.logger.error('Error getting work status:', error);
            // Clear cache on error
            this.workStatusCache = null;
            this.lastWorkStatusFetch = 0;
            return null;
        }
    }

    /**
     * Clear the work status cache and notify listeners (call after state changes like check-in, check-out, pause)
     */
    private clearWorkStatusCache(): void {
        this.workStatusCache = null;
        this.lastWorkStatusFetch = 0;
        streamDeck.logger.info('Work status cache cleared');

        // Notify all listeners that status might have changed
        this.statusChangeListeners.forEach(listener => {
            try {
                listener();
            } catch (error) {
                streamDeck.logger.error('Error in status change listener:', error);
            }
        });
    }

    /**
     * Add a listener for work status changes
     */
    public addStatusChangeListener(listener: () => void): void {
        this.statusChangeListeners.push(listener);
    }

    /**
     * Remove a status change listener
     */
    public removeStatusChangeListener(listener: () => void): void {
        const index = this.statusChangeListeners.indexOf(listener);
        if (index > -1) {
            this.statusChangeListeners.splice(index, 1);
        }
    }

    /**
     * Start polling for status changes
     */
    private startPolling(): void {
        // Stop any existing polling
        this.stopPolling();

        streamDeck.logger.info('Starting status polling (every 30 seconds)');

        // Get initial status
        this.checkForStatusChanges();

        // Poll every 30 seconds
        this.pollingInterval = setInterval(() => {
            this.checkForStatusChanges();
        }, this.POLLING_INTERVAL_MS);
    }

    /**
     * Stop polling for status changes
     */
    private stopPolling(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            streamDeck.logger.info('Status polling stopped');
        }
    }

    /**
     * Check if work status has changed and notify listeners
     */
    private async checkForStatusChanges(): Promise<void> {
        try {
            const status = await this.getWorkStatus();

            if (!status) {
                return;
            }

            // Check if status changed
            if (this.lastKnownStatus !== null && this.lastKnownStatus !== status.workStatus) {
                streamDeck.logger.info(`Work status changed: ${this.lastKnownStatus} -> ${status.workStatus}`);

                // Clear cache and notify listeners
                this.clearWorkStatusCache();
            }

            // Update last known status
            this.lastKnownStatus = status.workStatus;
        } catch (error) {
            streamDeck.logger.error('Error checking for status changes:', error);
        }
    }

    /**
     * Initialize polling if authenticated
     */
    async initializePolling(): Promise<void> {
        const isAuth = await this.isAuthenticated();
        if (isAuth) {
            streamDeck.logger.info('User is authenticated, starting polling...');
            this.startPolling();
        } else {
            streamDeck.logger.info('User not authenticated, skipping polling');
        }
    }

    /**
     * Calculate current work time from lastCheck data
     */
    calculateCurrentWorkTime(lastCheck: any): number {
        if (!lastCheck || !lastCheck.checkInDatetime) {
            return 0;
        }

        const checkInTime = new Date(lastCheck.checkInDatetime);
        const now = new Date();
        const workTimeSeconds = Math.floor((now.getTime() - checkInTime.getTime()) / 1000);

        return workTimeSeconds;
    }

    /**
     * Format work time in HH:MM format
     */
    formatWorkTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    /**
     * Check in to work
     */
    async checkIn(employeeId: string): Promise<CheckInResponse | null> {
        try {
            streamDeck.logger.info(`Attempting check-in for employee: ${employeeId}`);
            const response = await this.makeAuthenticatedRequest(`/employees/${employeeId}/check-in`, {
                method: 'POST',
                body: JSON.stringify({
                    origin: "web",
                    coordinates: {},
                    workCheckTypeId: null
                })
            });

            streamDeck.logger.info(`Check-in response status: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                streamDeck.logger.error(`Check-in failed: ${response.status} ${response.statusText} - ${errorText}`);
                throw new Error(`Check-in failed: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            streamDeck.logger.info('Check-in successful:', data);

            // Clear cache since work status changed
            this.clearWorkStatusCache();

            return data as CheckInResponse;
        } catch (error) {
            streamDeck.logger.error('Check-in error:', error);
            return null;
        }
    }

    /**
     * Pause work with selected work break
     */
    async pause(employeeId: string, workBreakId: string): Promise<PauseResponse | null> {
        try {
            streamDeck.logger.info(`Attempting pause for employee: ${employeeId} with workBreak: ${workBreakId}`);
            const response = await this.makeAuthenticatedRequest(`/employees/${employeeId}/pause`, {
                method: 'POST',
                body: JSON.stringify({
                    workBreakId: workBreakId
                })
            });

            streamDeck.logger.info(`Pause response status: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                streamDeck.logger.error(`Pause failed: ${response.status} ${response.statusText} - ${errorText}`);
                throw new Error(`Pause failed: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            streamDeck.logger.info('Pause successful:', data);

            // Clear cache since work status changed
            this.clearWorkStatusCache();

            return data as PauseResponse;
        } catch (error) {
            streamDeck.logger.error('Pause error:', error);
            return null;
        }
    }

    /**
     * Get all work breaks for an employee
     */
    async getAllWorkBreaks(employeeId: string): Promise<WorkBreak[] | null> {
        try {
            streamDeck.logger.info(`Fetching work breaks for employee: ${employeeId}`);
            const response = await this.makeAuthenticatedRequest(`/employees/${employeeId}/work-breaks-by-employee`);

            if (!response.ok) {
                const errorText = await response.text();
                streamDeck.logger.error(`Get work breaks failed: ${response.status} ${response.statusText} - ${errorText}`);
                throw new Error(`Failed to get work breaks: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json() as WorkBreaksResponse;
            streamDeck.logger.info(`Retrieved ${data.data.length} work breaks`);

            return data.data;
        } catch (error) {
            streamDeck.logger.error('Get work breaks error:', error);
            return null;
        }
    }

    /**
     * Check out from work
     */
    async checkOut(employeeId: string): Promise<CheckInResponse | null> {
        try {
            streamDeck.logger.info(`Attempting check-out for employee: ${employeeId}`);
            const response = await this.makeAuthenticatedRequest(`/employees/${employeeId}/check-out`, {
                method: 'POST',
                body: JSON.stringify({
                    origin: "web",
                    coordinates: {},
                    workCheckTypeId: null
                })
            });

            streamDeck.logger.info(`Check-out response status: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                streamDeck.logger.error(`Check-out failed: ${response.status} ${response.statusText} - ${errorText}`);
                throw new Error(`Check-out failed: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            streamDeck.logger.info('Check-out successful:', data);

            // Clear cache since work status changed
            this.clearWorkStatusCache();

            return data as CheckInResponse;
        } catch (error) {
            streamDeck.logger.error('Check-out error:', error);
            return null;
        }
    }
}

// Singleton instance
export const sesameAPI = new SesameAPI();

// Types
export type WorkStatusType = 'online' | 'paused' | 'offline';

export interface WorkBreak {
    id: string;
    name: string;
    color: string;
    icon: string;
    remunerated: boolean;
    breakMinutes: number;
    automatic: boolean;
    active: boolean;
    startTime: string;
    endTime: string;
    weekdays: string[];
}

export interface WorkBreaksResponse {
    data: WorkBreak[];
    meta: {
        currentPage: number;
        lastPage: number;
        total: number;
        perPage: number;
    };
}

export interface PauseResponse {
    data: {
        accumulatedSeconds: number;
        canDelete: boolean;
        canEditCheckInORCheckOut: boolean;
        checkIn: any;
        checkOut: any;
        checkType: string;
        employeeId: string;
        id: string;
        workBreak: WorkBreak;
        workBreakId: string;
        workStatus: WorkStatusType;
        computedHourStat: {
            totalSeconds: number;
            secondsWorked: number;
            secondsToWork: number;
        };
    };
    meta: {
        currentPage: number;
        lastPage: number;
        total: number;
        perPage: number;
    };
}

export interface LastCheck {
    checkId: string;
    checkInCoordinates: {
        latitude: number;
        longitude: number;
    };
    checkInDatetime: string;
    checkInWorkCheckTypeId: string | null;
    checkOutCoordinates: {
        latitude: number;
        longitude: number;
    } | null;
    checkOutDatetime: string | null;
    checkOutWorkCheckTypeId: string | null;
    workStatus: WorkStatusType;
    computedHourStat?: {
        totalSeconds?: number;
        secondsWorked?: number;
        secondsToWork?: number;
        [key: string]: any;
    };
}

export interface WorkStatus {
    workStatus: WorkStatusType;
    lastCheck: LastCheck | null;
    employeeId: string;
}

export interface CheckInResponse {
    data: {
        id: string;
        employeeId: string;
        workStatus: WorkStatusType;
        checkInDatetime: string;
    };
}

export interface EmployeeStatisticsResponse {
    data: EmployeeStatistics;
    meta: {
        currentPage: number;
        lastPage: number;
        total: number;
        perPage: number;
    };
}

export interface EmployeeStatistics {
    secondsWorked: number;
    secondsToWork: number;
    [key: string]: any;
}

export interface DailyComputedHourStatsResponse {
    data: DailyComputedHourStat | DailyComputedHourStat[];
    meta?: {
        currentPage: number;
        lastPage: number;
        total: number;
        perPage: number;
    };
}

export interface DailyComputedHourStat {
    date: string;
    employeeId: string;
    workedSeconds: number;
    secondsToWork: number;
    secondsWorked?: number;
    breakSeconds?: number;
    overtimeSeconds?: number;
    balance?: number;
    [key: string]: any;
}

export interface EmployeeChecksResponse {
    data: EmployeeCheck[];
    meta: {
        currentPage: number;
        lastPage: number;
        total: number;
        perPage: number;
    };
}

export interface EmployeeCheck {
    id: string;
    checkType: string;
    accumulatedSeconds?: number;
    checkIn: EmployeeCheckMoment | null;
    checkOut: EmployeeCheckMoment | null;
    workBreakId?: string | null;
    workBreak?: WorkBreak | null;
    [key: string]: any;
}

export interface EmployeeCheckMoment {
    date: string | null;
    timezone?: string | null;
    [key: string]: any;
}
