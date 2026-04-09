import express, { Request, Response } from 'express';
import cors from 'cors';
import { dbManager } from '../db/DBManager';
import logger, { logEmitter } from '../utils/logger';
import { Orchestrator } from '../controller/Orchestrator';
import { emailSender } from '../automation/EmailSender';
import { emailEngine } from '../brain/EmailEngine';
import path from 'path';
import * as fs from 'fs';
import { RichProfile } from '../brain/DataMapper';
import { EngineConfig } from '../utils/Config';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Serve success screenshots statically
app.use('/screenshots', express.static(path.join(process.cwd(), 'screenshots')));

const PORT = parseInt(process.env.PORT || '5000');

// ── PROFILE MANAGEMENT ───────────────────────────────────────────────────────

const PROFILE_PATH = path.join(process.cwd(), 'nikhil.json');

const loadRichProfile = (): RichProfile => {
    try {
        const raw = fs.readFileSync(PROFILE_PATH, 'utf8');
        const profile = JSON.parse(raw);
        profile.resumePath = profile.resumePath || '/home/nikhil/Startup/Helper/Nikhil_Resume.pdf';
        return profile;
    } catch (err) {
        logger.warn('Profile nikhil.json not found. Using safety fallback.');
        return {
            personal_information: {
                first_name: 'Nikhil', last_name: 'Kumar', full_name: 'Nikhil Kumar',
                gender: 'Male', date_of_birth: '', nationality: 'Indian', marital_status: 'Single'
            },
            contact_information: {
                email: 'nikhilkumar.career@gmail.com',
                phone_primary: '+91-6201784889',
                current_location: 'New Delhi, India',
                willing_to_relocate: true
            },
            online_profiles: {
                linkedin: 'https://linkedin.com/in/nikhilkum1r',
                github: 'https://github.com/nikhilkum1r'
            },
            education: [], work_experience: [], projects: [], skills: {},
            certifications: [], achievements: [], languages: [],
            job_preferences: { roles: ['Machine Learning Engineer', 'Software Engineer'] },
            resumePath: '/home/nikhil/Startup/Helper/Nikhil_Resume.pdf'
        };
    }
};

let userProfile = loadRichProfile();

app.get('/api/profile', (_req: Request, res: Response) => {
    res.json(userProfile);
});

app.post('/api/profile', (req: Request, res: Response) => {
    try {
        const newProfile = req.body;
        if (!newProfile.personal_information || !newProfile.contact_information) {
            return res.status(400).json({ error: 'Invalid profile structure' });
        }
        newProfile.resumePath = newProfile.resumePath || '/home/nikhil/Startup/Helper/Nikhil_Resume.pdf';
        fs.writeFileSync(PROFILE_PATH, JSON.stringify(newProfile, null, 2));
        userProfile = newProfile;
        // Update active orchestrator's profile if running
        if (activeOrchestrator) {
            (activeOrchestrator as any).profile = userProfile;
        }
        logger.info('USER_PROFILE: Identity synchronized to disk.');
        res.json({ message: 'Profile updated successfully', profile: userProfile });
    } catch (err: any) {
        res.status(500).json({ error: 'Failed to save profile: ' + err.message });
    }
});

// ── ENGINE CONTROL ────────────────────────────────────────────────────────────

let activeOrchestrator: Orchestrator | null = null;
let isRunning = false;

app.get('/api/status', (_req: Request, res: Response) => {
    const stats = dbManager.getStats();
    res.json({ isRunning, protocol: EngineConfig.protocol, stats });
});

app.get('/api/config', (_req: Request, res: Response) => {
    res.json({
        sleepDisabled: EngineConfig.sleepDisabled,
        maxWorkers: EngineConfig.maxWorkers,
        discoveryInterval: EngineConfig.discoveryInterval,
        stealthLevel: EngineConfig.stealthLevel,
        protocol: EngineConfig.protocol,
        deepDiscovery: EngineConfig.deepDiscovery,
        matchThreshold: EngineConfig.matchThreshold,
        maxRetries: EngineConfig.maxRetries,
        minApplyIntervalMs: EngineConfig.minApplyIntervalMs,
        sameDomainCooldownMs: EngineConfig.sameDomainCooldownMs,
        retryCooldownMinutes: EngineConfig.retryCooldownMinutes
    });
});

app.post('/api/config', (req: Request, res: Response) => {
    const { sleepDisabled, maxWorkers, discoveryInterval, stealthLevel, deepDiscovery, protocol, matchThreshold, maxRetries, minApplyIntervalMs, sameDomainCooldownMs, retryCooldownMinutes } = req.body;

    if (protocol !== undefined) EngineConfig.setProtocol(protocol);
    if (sleepDisabled !== undefined) EngineConfig.sleepDisabled = sleepDisabled;
    if (maxWorkers !== undefined) EngineConfig.maxWorkers = Math.min(Math.max(parseInt(maxWorkers), 1), 8);
    if (discoveryInterval !== undefined) EngineConfig.discoveryInterval = parseInt(discoveryInterval);
    if (stealthLevel !== undefined) EngineConfig.stealthLevel = parseInt(stealthLevel);
    if (deepDiscovery !== undefined) EngineConfig.deepDiscovery = deepDiscovery;
    if (matchThreshold !== undefined) EngineConfig.matchThreshold = parseInt(matchThreshold);
    if (maxRetries !== undefined) EngineConfig.maxRetries = parseInt(maxRetries);
    if (minApplyIntervalMs !== undefined) EngineConfig.minApplyIntervalMs = parseInt(minApplyIntervalMs);
    if (sameDomainCooldownMs !== undefined) EngineConfig.sameDomainCooldownMs = parseInt(sameDomainCooldownMs);
    if (retryCooldownMinutes !== undefined) EngineConfig.retryCooldownMinutes = parseInt(retryCooldownMinutes);

    logger.info(`CONFIG_UPDATE: Engine synchronized (Protocol: ${EngineConfig.protocol}, Threshold: ${EngineConfig.matchThreshold}%).`);
    res.json({
        sleepDisabled: EngineConfig.sleepDisabled,
        maxWorkers: EngineConfig.maxWorkers,
        discoveryInterval: EngineConfig.discoveryInterval,
        stealthLevel: EngineConfig.stealthLevel,
        protocol: EngineConfig.protocol,
        deepDiscovery: EngineConfig.deepDiscovery,
        matchThreshold: EngineConfig.matchThreshold,
        maxRetries: EngineConfig.maxRetries,
        minApplyIntervalMs: EngineConfig.minApplyIntervalMs,
        sameDomainCooldownMs: EngineConfig.sameDomainCooldownMs,
        retryCooldownMinutes: EngineConfig.retryCooldownMinutes
    });
});

// ── DATA ENDPOINTS ────────────────────────────────────────────────────────────

app.get('/api/stats', (_req: Request, res: Response) => {
    try {
        const stats = dbManager.getStats();
        const jobs = dbManager.getRecentJobs(30);
        res.json({ jobs, stats });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/crm/contacts', (_req: Request, res: Response) => {
    try {
        res.json(dbManager.getContacts());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/email/queue', (_req: Request, res: Response) => {
    try {
        res.json(dbManager.getEmailQueue());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/manual-list', (_req: Request, res: Response) => {
    try {
        res.json(dbManager.getManualList());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/failed-jobs', (_req: Request, res: Response) => {
    try {
        res.json(dbManager.getFailedJobsForRetry());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ── ENGINE START / STOP ───────────────────────────────────────────────────────

app.post('/api/start', async (req: Request, res: Response) => {
    if (isRunning) {
        return res.status(400).json({ error: 'Engine is already active', isRunning: true });
    }

    const { query, source, protocol } = req.body;

    if (protocol) EngineConfig.setProtocol(protocol);

    isRunning = true;
    const defaultRole = userProfile.job_preferences?.roles?.[0] || 'Software Engineer';
    res.json({ message: '♾ Infinite Horizon Engine ENGAGED', query: query || defaultRole });

    // Run non-blocking
    (async () => {
        try {
            activeOrchestrator = new Orchestrator(userProfile);
            await activeOrchestrator.start(query || defaultRole, source || 'ALL');
        } catch (err: any) {
            logger.error('Engine fatal failure:', err.message);
        } finally {
            isRunning = false;
            activeOrchestrator = null;
            logger.info('Engine session concluded.');
        }
    })();
});

app.post('/api/stop', (_req: Request, res: Response) => {
    if (activeOrchestrator) {
        activeOrchestrator.stop();
        isRunning = false;
        res.json({ message: 'Stop signal sent to Horizon Engine' });
    } else {
        isRunning = false;
        res.status(400).json({ error: 'No active engine session' });
    }
});

// ── UTILITY ENDPOINTS ─────────────────────────────────────────────────────────

app.post('/api/reset-stuck', (_req: Request, res: Response) => {
    try {
        const count = dbManager.resetStuckJobs();
        res.json({ message: `Reset ${count} stuck jobs back to retry queue`, count });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ── SSE LOGS STREAM ───────────────────────────────────────────────────────────

app.get('/api/logs', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send initial connection confirmation
    res.write(`data: ${JSON.stringify({ log: '=== HORIZON LOG STREAM CONNECTED ===' })}\n\n`);

    const sendPulse = setInterval(() => res.write(': pulse\n\n'), 15000);
    const logHandler = (msg: string) => {
        try {
            res.write(`data: ${JSON.stringify({ log: msg })}\n\n`);
        } catch { }
    };

    logEmitter.on('new-log', logHandler);
    req.on('close', () => {
        logEmitter.off('new-log', logHandler);
        clearInterval(sendPulse);
    });
});

// ── COMMAND EXECUTOR ──────────────────────────────────────────────────────────

app.post('/api/commands/execute', async (req: Request, res: Response) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'No command specified' });

    logger.info(`COMMAND_RECEIVED: ${command}`);

    try {
        const cmd = command.toUpperCase().trim();

        switch (cmd) {
            case 'START SEARCH': {
                // Kick off just the discovery phase without workers
                if (isRunning) return res.status(400).json({ error: 'Engine already running' });
                const role = userProfile.job_preferences?.roles?.[0] || 'Software Engineer';
                res.json({ message: `Discovery sweep initiated for: ${role}` });
                // Run discovery only
                (async () => {
                    const { AggregatorEngine } = await import('../discovery/AggregatorEngine');
                    const { BrowserBase } = await import('../automation/BrowserBase');
                    const engine = new AggregatorEngine();
                    const browser = new BrowserBase();
                    try {
                        await browser.init(process.env.CHROME_PROFILE || 'Profile 2', true); // headless
                        const page = await browser.createPage();
                        await engine.discover(role, page, 'ALL');
                        await page.close().catch(() => {});
                        logger.info('COMMAND: Discovery sweep complete.');
                    } finally {
                        await browser.close();
                    }
                })().catch(err => logger.error('COMMAND:START_SEARCH error:', err));
                break;
            }

            case 'START APPLY': {
                // Process all pending jobs in queue without discovery
                if (isRunning) return res.status(400).json({ error: 'Engine already running' });
                const pending = dbManager.getPendingJobs();
                res.json({ message: `Apply mode: processing ${pending.length} pending jobs` });
                (async () => {
                    const { AutomationWorker } = await import('../controller/AutomationWorker');
                    const { BrowserBase } = await import('../automation/BrowserBase');
                    const browser = new BrowserBase();
                    try {
                        await browser.init(process.env.CHROME_PROFILE || 'Profile 2', false);
                        for (const job of pending.slice(0, 10)) {
                            const claimed = dbManager.claimJob();
                            if (!claimed) break;
                            const worker = new AutomationWorker(userProfile);
                            await worker.processJob(claimed, browser).catch((e: any) => logger.error('APPLY_CMD error:', e));
                        }
                    } finally {
                        await browser.close();
                    }
                })().catch(err => logger.error('COMMAND:START_APPLY error:', err));
                break;
            }

            case 'GENERATE EMAILS': {
                const pending = dbManager.getPendingJobs().slice(0, 20);
                res.json({ message: `Generating emails for ${pending.length} jobs` });
                (async () => {
                    const profile = userProfile;
                    for (const job of pending) {
                        const email = `careers@${new URL(job.url).hostname.replace('www.', '')}`;
                        await emailEngine.generateApplicationEmail({ ...job, hrEmail: email }, profile)
                            .catch(e => logger.warn(`Email gen fail: ${e.message}`));
                    }
                    logger.info(`EMAIL_GEN: Queued emails for ${pending.length} jobs.`);
                })().catch(err => logger.error('COMMAND:GENERATE_EMAILS error:', err));
                break;
            }

            case 'START EMAIL SENDING': {
                res.json({ message: 'Email delivery engine flushed' });
                emailSender.sendPendingEmails().catch(err => logger.error('EMAIL_SEND error:', err));
                break;
            }

            case 'RESET STUCK': {
                const count = dbManager.resetStuckJobs();
                res.json({ message: `Reset ${count} stuck IN_PROGRESS jobs` });
                break;
            }

            case 'SHOW STATUS': {
                const stats = dbManager.getStats();
                res.json({
                    message: `Applied: ${stats.applied} | Pending: ${stats.pending} | Failed: ${stats.failed} | Contacts: ${stats.contacts}`,
                    stats
                });
                break;
            }

            default:
                res.status(400).json({ error: `Unknown command: ${command}. Available: START SEARCH, START APPLY, GENERATE EMAILS, START EMAIL SENDING, RESET STUCK, SHOW STATUS` });
        }
    } catch (err: any) {
        logger.error(`COMMAND_ERROR: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────

app.use((err: any, _req: Request, res: Response, _next: any) => {
    logger.error('API_ERROR:', err.message);
    res.status(500).json({ error: err.message });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`=== HORIZON ENGINE API ONLINE: http://localhost:${PORT} ===`);
});

server.on('error', (err: any) => {
    logger.error(`SERVER_BOOT_ERROR: ${err?.message || err}`);
});
