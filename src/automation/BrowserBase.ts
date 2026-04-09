import { chromium } from 'playwright-extra';
import { Browser, BrowserContext, Page } from 'playwright';
const stealth = require('puppeteer-extra-plugin-stealth')();
import * as dotenv from 'dotenv';
import logger from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

dotenv.config();
chromium.use(stealth);

export class BrowserBase {
    private static sharedContext: BrowserContext | null = null;
    private static sharedBrowser: Browser | null = null;
    private static isInitializing = false;

    async init(profileName: string = 'default', forceHeadless: boolean = false) {
        if (BrowserBase.sharedContext) {
            if (await this.isAlive()) {
                return;
            } else {
                logger.warn('SHARED_SESSION: Existing context dead or stale. Re-initializing...');
                await this.close();
            }
        }

        if (BrowserBase.isInitializing) {
            while (BrowserBase.isInitializing) {
                await new Promise(r => setTimeout(r, 100));
            }
            return;
        }

        BrowserBase.isInitializing = true;
        
        try {
            // Prefer attaching to a user-launched Chrome with remote debugging.
            const cdpUrl = process.env.CHROME_CDP_URL || '';
            if (cdpUrl) {
                logger.info(`Browser initializing via CDP: ${cdpUrl}`);
                BrowserBase.sharedBrowser = await chromium.connectOverCDP(cdpUrl);
                const existing = BrowserBase.sharedBrowser.contexts();
                BrowserBase.sharedContext = existing[0] || await BrowserBase.sharedBrowser.newContext();
                logger.info('Browser [CDP Session Reuse] initialized successfully.');
                return;
            }

            // Determine primary Chrome profile paths based on OS
            const isWin = os.platform() === 'win32';
            const profileDirectory = this.normalizeProfileDirectory(process.env.CHROME_PROFILE || profileName || 'Default');
            const baseUserDataDir = this.resolveChromeUserDataDir(isWin);

            let userDataDir = baseUserDataDir;
            
            // CRITICAL REQUIREMENT: Always use real chrome, correctly configured headful
            const launchOptions = {
                channel: 'chrome', // Use real Chrome installation
                headless: forceHeadless ? true : false,
                viewport: null,    // Let window size take over organically
                ignoreDefaultArgs: ['--enable-automation'], // Prevent "Chrome is being controlled by automated test software"
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--start-maximized',
                    `--profile-directory=${profileDirectory}`,
                ]
            };

            logger.info(`Browser initializing. Primary UserDataDir: ${userDataDir} | Profile: ${profileDirectory}`);

            try {
                // Try to launch with the real user data dir first. 
                // Playwright `launchPersistentContext` will throw if Chrome is already open.
                BrowserBase.sharedContext = await (chromium as any).launchPersistentContext(userDataDir, launchOptions);
            } catch (e: any) {
                const message = String(e?.message || '');
                if (message.includes('browser has been closed') || message.includes('lock') || message.includes('SingletonLock')) {
                    logger.warn('CHROME LOCKED: Browser is currently open. Cloning profile for automation as requested...');
                    
                    const backupDir = path.join(
                        process.cwd(),
                        `chrome_backup_profile_${profileDirectory.replace(/\s+/g, '_').toLowerCase()}`
                    );
                    
                    // Create minimal clone if it doesn't exist
                    if (!fs.existsSync(backupDir)) {
                        fs.mkdirSync(backupDir, { recursive: true });
                        logger.info(`Creating automation shadow copy of Chrome profile... (This may take a minute)`);
                        
                        try {
                            if (isWin) {
                                // Windows copy
                                execSync(`xcopy "${path.join(baseUserDataDir, 'Local State')}" "${backupDir}\\" /K /D /H /Y`);
                                execSync(`xcopy "${path.join(baseUserDataDir, profileDirectory)}" "${path.join(backupDir, profileDirectory)}\\" /E /I /H /K /Y /EXCLUDE:exclude.txt`, { stdio: 'ignore' });
                            } else {
                                // Linux/Mac copy
                                execSync(`cp "${path.join(baseUserDataDir, 'Local State')}" "${backupDir}/" 2>/dev/null || true`);
                                execSync(`rsync -a --exclude 'Cache' --exclude 'Code Cache' --exclude 'Service Worker/CacheStorage' "${path.join(baseUserDataDir, profileDirectory)}" "${backupDir}/"`);
                            }
                            logger.info('Shadow profile created successfully.');
                        } catch (copyErr: any) {
                            logger.warn(`Warning during profile copy: ${copyErr.message}`);
                        }
                    } else {
                        logger.info('Using existing shadow profile at: ' + backupDir);
                    }

                    // FORCE cleanup stale locks only in the secure shadow copy
                    const staleLocks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'SingletonContext'];
                    for (const lock of staleLocks) {
                        try {
                            const p = path.join(backupDir, lock);
                            if (fs.existsSync(p)) fs.unlinkSync(p);
                        } catch (er) { }
                        
                        try {
                            const p2 = path.join(backupDir, profileDirectory, lock);
                            if (fs.existsSync(p2)) fs.unlinkSync(p2);
                        } catch (er) { }
                    }

                    // Attempt launch with backup directory
                    BrowserBase.sharedContext = await (chromium as any).launchPersistentContext(backupDir, launchOptions);
                } else {
                    throw e;
                }
            }
            
            logger.info('Browser [Persistent Auth] initialized successfully.');
        } catch (error) {
            logger.error('Failed to initialize persistent browser:', error);
            throw error;
        } finally {
            BrowserBase.isInitializing = false;
        }
    }

    async createPage(): Promise<Page> {
        if (!BrowserBase.sharedContext) throw new Error('Browser not initialized');
        
        // Always create a distinct new page to avoid race conditions 
        // where concurrent workers grab the same 'about:blank' tab.
        const page = await BrowserBase.sharedContext.newPage();
        
        // Do not close other existing tabs in shared profile sessions.

        // Add additional stealth markers to evade strict anti-bot detection
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            // Mock permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters: any) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission } as PermissionStatus) :
                    originalQuery(parameters)
            );
        });

        // Add random stealth viewport offsets
        const viewportHeight = 800 + Math.floor(Math.random() * 200);
        const viewportWidth = 1200 + Math.floor(Math.random() * 400);
        await page.setViewportSize({ width: viewportWidth, height: viewportHeight }).catch(() => {});

        return page;
    }

    async isAlive(): Promise<boolean> {
        if (!BrowserBase.sharedContext) return false;
        try {
            // Probe with a temporary page to avoid false negatives from stale tabs.
            const tempPage = await BrowserBase.sharedContext.newPage();
            await tempPage.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
            await tempPage.close().catch(() => {});
            return true;
        } catch {
            return false;
        }
    }

    async close() {
        if (BrowserBase.sharedContext) {
            try {
                await BrowserBase.sharedContext.close().catch(() => {});
            } finally {
                BrowserBase.sharedContext = null;
                logger.info('Persistent Browser session safely closed.');
            }
        }
        if (BrowserBase.sharedBrowser) {
            await BrowserBase.sharedBrowser.close().catch(() => {});
            BrowserBase.sharedBrowser = null;
        }
    }

    private resolveChromeUserDataDir(isWin: boolean): string {
        if (process.env.CHROME_USER_DATA_DIR) {
            return process.env.CHROME_USER_DATA_DIR;
        }
        if (isWin) {
            return path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
        }
        const linuxCandidates = [
            path.join(os.homedir(), '.config', 'google-chrome'),
            path.join(os.homedir(), '.config', 'google-chrome-stable'),
            path.join(os.homedir(), '.config', 'chromium'),
        ];
        for (const candidate of linuxCandidates) {
            if (fs.existsSync(candidate)) return candidate;
        }
        return linuxCandidates[0];
    }

    private normalizeProfileDirectory(raw: string): string {
        const value = String(raw || '').trim();
        if (!value) return 'Default';
        const lower = value.toLowerCase();
        if (lower === 'default' || lower === 'profile0' || lower === 'profile 0') return 'Default';
        if (lower === 'profile2' || lower === 'profile-2') return 'Profile 2';
        if (/^profile\s+\d+$/i.test(value)) return value.replace(/\s+/, ' ');
        return value;
    }
}
