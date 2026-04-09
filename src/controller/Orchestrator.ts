import { AutomationWorker } from './AutomationWorker';
import { AggregatorEngine } from '../discovery/AggregatorEngine';
import { dbManager } from '../db/DBManager';
import { DataMapper, RichProfile } from '../brain/DataMapper';
import { BrowserBase } from '../automation/BrowserBase';
import { EngineConfig } from '../utils/Config';
import logger from '../utils/logger';

export class Orchestrator {
    private profile: RichProfile;
    private discoveryEngine: AggregatorEngine;
    private activeWorkers = 0;
    private stopRequested = false;
    private targetSource = 'ALL';
    private workerBrowser: BrowserBase | null = null;
    private browserInitPromise: Promise<BrowserBase> | null = null;
    private lastApplyStartedAt = 0;
    private domainCooldown = new Map<string, number>();

    constructor(profile: RichProfile) {
        this.profile = profile;
        this.discoveryEngine = new AggregatorEngine();
    }

    async stop() {
        this.stopRequested = true;
        logger.info('GLOBAL STOP: Initiating graceful shutdown...');
        
        // Wait for workers to finish (up to 30s)
        let waitCount = 0;
        while (this.activeWorkers > 0 && waitCount < 30) {
            await this.sleep(1000);
            waitCount++;
        }

        if (this.workerBrowser) {
            await this.workerBrowser.close().catch(() => {});
            this.workerBrowser = null;
        }
    }

    async start(initialQuery: string, source: string = 'ALL') {
        logger.info('=== ♾ INFINITE HORIZON: GOD-MODE ENGAGED ===');
        this.stopRequested = false;
        this.targetSource = source;

        // Step 0: Reset any jobs stuck in IN_PROGRESS from last session
        const resetCount = dbManager.resetStuckJobs();
        if (resetCount > 0) logger.info(`STARTUP: Freed ${resetCount} stuck jobs from previous session.`);

        // Step 1: Initialize shared persistent browser
        this.workerBrowser = new BrowserBase();
        await this.getOrCreateBrowser();

        // Step 2: Launch discovery loop in background (non-blocking)
        this.startDiscoveryLoop(initialQuery).catch(err =>
            logger.error('Discovery loop crashed:', err)
        );

        // Step 3: Launch worker hive in background (non-blocking)
        this.startWorkerHive().catch(err =>
            logger.error('Worker hive crashed:', err)
        );

        // Step 4: Maintenance loop (blocking — keeps process alive)
        await this.runMaintenanceLoop();
    }

    private async getOrCreateBrowser(): Promise<BrowserBase> {
        if (this.browserInitPromise) {
            return this.browserInitPromise;
        }

        this.browserInitPromise = this.ensureBrowser();
        try {
            return await this.browserInitPromise;
        } finally {
            this.browserInitPromise = null;
        }
    }

    private async ensureBrowser(): Promise<BrowserBase> {
        if (!this.workerBrowser) {
            this.workerBrowser = new BrowserBase();
        }
        
        // Standard check + re-init if dead
        try {
            await this.workerBrowser.init(process.env.CHROME_PROFILE || 'Profile 2', process.env.HEADLESS === 'true');
            await this.sleep(2000); // Stabilization delay for IPC connections
        } catch (err) {
            logger.error('BROWSER_RECOVERY: Failed to ensure browser is alive.', err);
            // If it failed to init, try closing and creating fresh instance
            await this.workerBrowser.close().catch(() => {});
            this.workerBrowser = new BrowserBase();
            await this.workerBrowser.init(process.env.CHROME_PROFILE || 'Profile 2', process.env.HEADLESS === 'true');
            await this.sleep(2000); // Stabilization delay
        }
        return this.workerBrowser;
    }

    private async startDiscoveryLoop(initialQuery: string) {
        const queries = this.profile.job_preferences?.roles?.length > 0
            ? this.profile.job_preferences.roles
            : [initialQuery];

        let qIndex = 0;

        while (!this.stopRequested) {
            try {
                if (!EngineConfig.discoveryWhenPending && dbManager.hasPendingWork()) {
                    logger.info('DISCOVERY: Pending apply work exists. Delaying new discovery cycle.');
                    await this.sleep(30000);
                    continue;
                }

                const currentQuery = queries[qIndex % queries.length];
                const browser = await this.getOrCreateBrowser();
                const page = await browser.createPage();

                logger.info(`DISCOVERY_CYCLE [${qIndex + 1}]: Sweeping for "${currentQuery}" on [${this.targetSource}]...`);
                await this.discoveryEngine.discover(currentQuery, page, this.targetSource);

                await page.close().catch(() => {});
                qIndex++;

                const restTime = EngineConfig.discoveryInterval + Math.random() * 30000;
                logger.info(`DISCOVERY: Next cycle in ${Math.round(restTime / 1000)}s.`);
                await this.sleep(restTime);
            } catch (err) {
                logger.error('Discovery loop error:', err);
                await this.sleep(15000);
            }
        }
    }

    private async startWorkerHive() {
        while (!this.stopRequested) {
            if (this.activeWorkers < Math.max(1, EngineConfig.maxWorkers)) {
                // Try regular unclaimed jobs first
                let job = dbManager.claimJob();

                if (job) {
                    await this.applyPacing(job);
                    const success = await this.spawnWorker(job);
                    if (!success) {
                        // Prevent "loop of death" if workers are failing instantly
                        await this.sleep(2500); 
                    }
                } else {
                    await this.sleep(2500);
                }
            } else {
                await this.sleep(1000);
            }
        }
    }

    private async runMaintenanceLoop() {
        while (!this.stopRequested) {
            try {
                logger.info('── MAINTENANCE: Running health checks ──');

                // 1. Reset stuck IN_PROGRESS jobs
                const resetCount = dbManager.resetStuckJobs();
                if (resetCount > 0) logger.info(`MAINTENANCE: Reset ${resetCount} stuck jobs.`);

                // 2. Log current stats
                const stats = dbManager.getStats();
                logger.info(
                    `STATS: Applied=${stats.applied} | Failed=${stats.failed} | Skipped=${stats.skipped} | ` +
                    `Pending=${stats.pending} | EmailQueued=${stats.emailQueued} | Total=${stats.totalJobs}`
                );

                // 3. Alert if too many failures
                if (stats.failed > 20 && stats.applied < 5) {
                    logger.warn('MAINTENANCE: High failure rate detected. Consider switching to TURBO protocol or checking browser session.');
                }

                await this.sleep(3600000); // Every hour
            } catch (err) {
                logger.error('Maintenance loop error:', err);
                await this.sleep(60000);
            }
        }
    }

    private async spawnWorker(job: any): Promise<boolean> {
        this.activeWorkers++;
        logger.info(`SPAWN: Worker engaging → ${job.title} @ ${job.company}`);

        let success = false;
        try {
            const browser = await this.getOrCreateBrowser();
            const worker = new AutomationWorker(this.profile);
            success = await worker.processJob(job, browser);
        } catch (err) {
            logger.error(`WORKER_FATAL: Execution failed for ${job.id}`, err);
        } finally {
            this.activeWorkers--;
            logger.info(`RELEASE: Worker complete for ${job.company}.`);
        }
        return success;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(r => setTimeout(r, ms));
    }

    private async applyPacing(job: any): Promise<void> {
        const now = Date.now();
        const globalElapsed = now - this.lastApplyStartedAt;
        if (this.lastApplyStartedAt > 0 && globalElapsed < EngineConfig.minApplyIntervalMs) {
            const waitMs = EngineConfig.minApplyIntervalMs - globalElapsed;
            logger.info(`PACING: Global cooldown ${Math.round(waitMs / 1000)}s before next apply.`);
            await this.sleep(waitMs);
        }

        const domain = this.extractDomain(job?.url);
        if (domain) {
            const last = this.domainCooldown.get(domain) || 0;
            const elapsed = Date.now() - last;
            if (elapsed < EngineConfig.sameDomainCooldownMs) {
                const waitMs = EngineConfig.sameDomainCooldownMs - elapsed;
                logger.info(`PACING: Domain cooldown for ${domain} ${Math.round(waitMs / 1000)}s.`);
                await this.sleep(waitMs);
            }
            this.domainCooldown.set(domain, Date.now());
        }
        this.lastApplyStartedAt = Date.now();
    }

    private extractDomain(url?: string): string {
        try {
            if (!url) return '';
            return new URL(url).hostname.replace(/^www\./, '');
        } catch {
            return '';
        }
    }
}
