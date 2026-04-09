export type StrategyProtocol = 'STEALTH' | 'BALANCED' | 'TURBO';

export class EngineConfig {
    static sleepDisabled = false;
    static maxWorkers = 2;
    static discoveryInterval = 120000;     // 2 minutes between discovery cycles
    static stealthLevel = 3;               // 1 to 5
    static protocol: StrategyProtocol = 'BALANCED';
    static deepDiscovery = false;
    static geminiApiKey = process.env.GEMINI_API_KEY || '';
    static matchThreshold = 0;             // Try applying to all discovered jobs
    static maxRetries = 3;                 // Max retries for page navigation / actions
    static stuckJobTimeoutMinutes = 30;    // Minutes before IN_PROGRESS jobs are reset
    static retryCooldownMinutes = 30;      // Cooldown before retrying FAILED/SKIPPED jobs
    static discoveryWhenPending = false;   // Prioritize applying before new discovery
    static minApplyIntervalMs = 8000;      // Global pause between apply attempts
    static sameDomainCooldownMs = 45000;   // Avoid burst attempts on same domain

    static setProtocol(p: StrategyProtocol) {
        this.protocol = p;
        if (p === 'STEALTH') {
            this.stealthLevel = 5;
            this.sleepDisabled = false;
            this.discoveryInterval = 180000;  // Slower discovery
        } else if (p === 'TURBO') {
            this.stealthLevel = 1;
            this.sleepDisabled = true;
            this.discoveryInterval = 60000;   // Faster discovery
        } else {
            this.stealthLevel = 3;
            this.sleepDisabled = false;
            this.discoveryInterval = 120000;
        }
    }
}
