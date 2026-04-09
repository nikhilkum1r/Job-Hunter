import { Page } from 'playwright';
import { BrowserBase } from '../automation/BrowserBase';
import { dbManager } from '../db/DBManager';
import { FieldDetector, DetectedField } from '../brain/FieldDetector';
import { DataMapper, RichProfile } from '../brain/DataMapper';
import { MatchAnalyzer } from '../brain/MatchAnalyzer';
import { Submitter } from '../automation/Submitter';
import { CoverLetterAI } from '../brain/CoverLetterAI';
import { QuestionSolverAI } from '../brain/QuestionSolverAI';
import { Humanoid } from '../automation/Humanoid';
import { SelfHealer } from '../brain/SelfHealer';
import { emailEngine } from '../brain/EmailEngine';
import { EngineConfig } from '../utils/Config';
import logger from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';

export class AutomationWorker {
    private browserBase: BrowserBase;
    private detector: FieldDetector;
    private mapper: DataMapper;
    private analyzer: MatchAnalyzer;
    private submitter: Submitter;
    private coverLetterAI: CoverLetterAI;
    private questionSolver: QuestionSolverAI;
    private selfHealer: SelfHealer;
    private humanoid: Humanoid | null = null;

    private readonly PORTAL_DOMAINS = [
        'linkedin.com', 'indeed.com', 'naukri.com', 'glassdoor.com',
        'wellfound.com', 'internshala.com', 'shine.com', 'foundit.in'
    ];

    private readonly PLATFORM_APPLY_SELECTORS: Record<string, string[]> = {
        LINKEDIN: [
            'button.jobs-apply-button',
            'button[aria-label*="Easy Apply"]',
            'button:has-text("Easy Apply")'
        ],
        INDEED: [
            'button:has-text("Apply now")',
            'a:has-text("Apply now")',
            'button:has-text("Easily apply")'
        ],
        NAUKRI: [
            'button:has-text("Apply")',
            'button:has-text("Apply on company site")',
            'a:has-text("Apply")'
        ]
    };

    constructor(profile: RichProfile) {
        this.browserBase = new BrowserBase();
        this.detector    = new FieldDetector();
        this.mapper      = new DataMapper(profile);
        this.analyzer    = new MatchAnalyzer();
        this.submitter   = new Submitter();
        this.coverLetterAI  = new CoverLetterAI();
        this.questionSolver = new QuestionSolverAI();
        this.selfHealer     = new SelfHealer();
    }

    async processJob(job: any, sharedBrowser?: BrowserBase): Promise<boolean> {
        let page: Page | null = null;
        const isShared = !!sharedBrowser;
        const feedback: Record<string, any> = {
            jobId: job?.id,
            company: job?.company,
            startedAt: new Date().toISOString(),
            stages: [] as string[],
            platform: 'GENERIC',
        };

        try {
            logger.info(`STRATEGY_INIT: Preparing → ${job.title} @ ${job.company}`);
            const profile = this.mapper.getRawProfile();

            if (isShared) {
                this.browserBase = sharedBrowser!;
            } else {
                await this.browserBase.init(process.env.CHROME_PROFILE || 'Profile 2', process.env.HEADLESS === 'true');
            }

            page = await this.browserBase.createPage();
            this.humanoid = new Humanoid(page);

            // ── PHASE 1: PAGE LOAD with retry ──────────────────────────────────
            const loaded = await this.navigateWithRetry(page, job.url);

            if (!loaded) {
                // Mailto fallback
                if (job.url.startsWith('mailto:')) {
                    const toEmail = job.url.replace('mailto:', '').split('?')[0];
                    logger.info(`EMAIL_STRATEGY: Mailto detected → ${toEmail}`);
                    await emailEngine.generateApplicationEmail({ ...job, hrEmail: toEmail }, profile);
                    dbManager.updateApplication(job.id, 'EMAIL_QUEUED', `Mailto: ${toEmail}`);
                    return true;
                }
                throw new Error('Page load failed after retries');
            }

            const currentUrl = page.url().toLowerCase();
            const isPortal = this.PORTAL_DOMAINS.some(d => currentUrl.includes(d));
            const platform = this.detectPlatform(currentUrl);
            feedback.platform = platform;
            feedback.stages.push('PAGE_LOADED');

            // ── PHASE 2: AUTH WALL CHECK ───────────────────────────────────────
            if (isPortal) {
                const isAuthWall = await this.detectAuthWall(page);
                if (isAuthWall) {
                    logger.warn(`AUTH_WALL: Login required on ${currentUrl}. Sending to manual list.`);
                    dbManager.saveToManualList(job.id, 'LOGIN_REQUIRED');
                    feedback.stages.push('AUTH_WALL');
                    dbManager.updateApplication(job.id, 'SKIPPED', 'AUTH_REQUIRED: Auth Wall Detected', undefined, feedback);
                    return false;
                }
                logger.info(`AUTH_MODE: Session confirmed for ${job.company}.`);
            } else {
                logger.info(`DIRECT_MODE: Career portal — proceeding as guest.`);
            }

            // ── PHASE 3: SCROLL + CONTENT ANALYSIS ────────────────────────────
            await this.humanoid!.scrollOrganic();
            feedback.stages.push('SCROLLED');
            logger.info(`STAGE: Attempting apply entry for platform ${platform}`);
            page = await this.openPlatformSpecificApplyFlow(page, platform);
            page = await this.openApplicationFormIfNeeded(page);
            feedback.stages.push('APPLY_FLOW_OPENED');

            if (platform === 'LINKEDIN') {
                const liResult = await this.handleLinkedInEasyApply(page, job, profile);
                if (liResult.handled && liResult.applied) {
                    feedback.stages.push('LINKEDIN_EASY_APPLY_SUCCESS');
                    dbManager.updateApplication(job.id, 'APPLIED', 'LinkedIn Easy Apply completed', 100, feedback);
                    logger.info(`✅ SUCCESS: LinkedIn Easy Apply completed for ${job.company}`);
                    return true;
                }
                if (liResult.handled && !liResult.applied) {
                    feedback.stages.push('LINKEDIN_EASY_APPLY_FAILED');
                    dbManager.updateApplication(job.id, 'FAILED', this.classifyFailure(liResult.reason || 'LinkedIn Easy Apply failed'), undefined, feedback);
                    return false;
                }
            }
            if (platform === 'INDEED') {
                const indeed = await this.handleIndeedApply(page, profile);
                if (indeed.handled && indeed.applied) {
                    dbManager.updateApplication(job.id, 'APPLIED', 'Indeed apply flow completed', 95, feedback);
                    logger.info(`✅ SUCCESS: Indeed apply completed for ${job.company}`);
                    return true;
                }
                if (indeed.handled && !indeed.applied) {
                    dbManager.updateApplication(job.id, 'FAILED', this.classifyFailure(indeed.reason || 'Indeed apply failed'), undefined, feedback);
                    return false;
                }
            }
            if (platform === 'NAUKRI') {
                const naukri = await this.handleNaukriApply(page, profile);
                if (naukri.handled && naukri.applied) {
                    dbManager.updateApplication(job.id, 'APPLIED', 'Naukri apply flow completed', 95, feedback);
                    logger.info(`✅ SUCCESS: Naukri apply completed for ${job.company}`);
                    return true;
                }
                if (naukri.handled && !naukri.applied) {
                    dbManager.updateApplication(job.id, 'FAILED', this.classifyFailure(naukri.reason || 'Naukri apply failed'), undefined, feedback);
                    return false;
                }
            }
            const pageText = await page.innerText('body').catch(() => '');

            // Recruiter Email Extraction
            const emailsOnPage = pageText.match(/[a-zA-Z0-9._%+-]+@(?!gmail\.|yahoo\.|hotmail\.|outlook\.)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
            if (emailsOnPage) {
                const uniqueEmails = [...new Set(emailsOnPage)].filter(e => !e.toLowerCase().startsWith('support@') && !e.toLowerCase().startsWith('info@'));
                for (const email of uniqueEmails) {
                    logger.info(`RECRUITER_CONTACT: Extracted ${email} from job page.`);
                    dbManager.saveContact({ 
                        email, 
                        company: job.company, 
                        source: 'Application Form', 
                        interactionHistory: JSON.stringify([{ date: new Date().toISOString(), type: 'RECRUITER_DISCOVERED', note: job.title }]) 
                    });
                }
            }

            // Get page description (first 4000 chars of visible text)
            const jobContext = (job.description || pageText).substring(0, 4000);
            const analysis = await this.analyzer.analyzeMatch(job.title + '\n' + jobContext, profile);

            const threshold = EngineConfig.matchThreshold;
            if (analysis.score < threshold) {
                logger.warn(`STRATEGY_SKIP: Low Match (${analysis.score}%). Reason: ${analysis.reason}`);
                dbManager.updateApplication(job.id, 'SKIPPED', analysis.reason, analysis.score);
                return false;
            }

            const isGoldMatch = analysis.score >= 80;
            logger.info(`STRATEGY_ENGAGED: ${isGoldMatch ? '⭐ GOLD' : 'SILVER'} Match (${analysis.score}%). Proceeding...`);

            // ── PHASE 4: FIELD DETECTION + FORM FILL ──────────────────────────
            // Wait for hydration/rendering to settle
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            await this.humanoid!.waitRandom(1000, 2000);
            
            // Explicitly wait for any common form element to appear
            await page.waitForSelector('input, select, textarea, [role="button"]', { timeout: 5000 }).catch(() => {});
            
            const dom = await page.content();
            const fields = await this.detector.analyzePage(dom, job.url);
            logger.info(`FIELD_MAP: Detected ${fields.length} form fields.`);
            feedback.stages.push(`FIELDS_DETECTED:${fields.length}`);

            let generatedCoverLetter = '';
            const filledFormLog: Record<string, string> = {};

            for (const field of fields) {
                await this.fillField(page, field, job, profile, isGoldMatch, generatedCoverLetter, filledFormLog)
                    .then(result => { if (result.coverLetter) generatedCoverLetter = result.coverLetter; })
                    .catch((err: any) => logger.warn(`WORKER_FIELD_FAIL: ${field.label} → ${err.message}`));

                await this.humanoid!.waitRandom(200, 600);
            }

            // ── PHASE 5: EMAIL FALLBACK ────────────────────────────────────────
            if (fields.length === 0) {
                const emailsOnPage = pageText.match(/[a-zA-Z0-9._%+-]+@(?!gmail\.|yahoo\.|hotmail\.|outlook\.)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
                if (emailsOnPage && emailsOnPage.length > 0) {
                    logger.info(`EMAIL_FALLBACK: No form found. Emailing ${emailsOnPage[0]}.`);
                    await emailEngine.generateApplicationEmail({ ...job, hrEmail: emailsOnPage[0] }, profile);
                    dbManager.updateApplication(job.id, 'EMAIL_QUEUED', `Fallback email: ${emailsOnPage[0]}`);
                    return true;
                }
                logger.warn('WORKER: No fields and no emails found. Skipping.');
                feedback.stages.push('NO_FORM_NO_EMAIL');
                dbManager.updateApplication(job.id, 'SKIPPED', 'NO_FORM_FOUND: No form or email found on page', undefined, feedback);
                return false;
            }

            // ── PHASE 6: SUBMISSION ────────────────────────────────────────────
            await this.humanoid!.waitRandom(1500, 3000);
            const isSubmitted = await this.submitter.attemptSubmit(page);

            if (isSubmitted) {
                const screenshotDir = path.join(process.cwd(), 'screenshots');
                if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
                const screenshotName = `success_${job.id}_${Date.now()}.png`;
                const screenshotPath = path.join(screenshotDir, screenshotName);

                await new Promise(r => setTimeout(r, 2000));
                await page.screenshot({ path: screenshotPath }).catch(() => {});

                dbManager.updateApplication(job.id, 'APPLIED', `Match: ${analysis.score}%`, analysis.score, filledFormLog, screenshotName);
                logger.info(`✅ SUCCESS: Applied to ${job.company} — ${job.title}`);
                return true;
            } else {
                const failureReason = await this.selfHealer.analyzeFailure(page, profile);
                feedback.stages.push('SUBMIT_FAILED');
                const merged = { ...filledFormLog, __feedback: feedback };
                dbManager.updateApplication(job.id, 'FAILED', this.classifyFailure(failureReason || 'Submit interaction failed'), analysis.score, merged);
                return false;
            }

        } catch (error: any) {
            const errorMsg = `WORKER_ERROR [${job.company}]: ${error.message}${error.stack ? '\n' + error.stack : ''}`;
            logger.error(errorMsg);
            feedback.stages.push('WORKER_EXCEPTION');
            dbManager.updateApplication(job.id, 'FAILED', this.classifyFailure(error.message || 'Unknown worker error'), undefined, feedback);
            return false;
        } finally {
            if (page) await page.close().catch(() => {});
            if (!isShared && this.browserBase) await this.browserBase.close().catch(() => {});
        }
    }

    // ── HELPERS ─────────────────────────────────────────────────────────────────

    private async navigateWithRetry(page: Page, url: string): Promise<boolean> {
        for (let attempt = 1; attempt <= EngineConfig.maxRetries; attempt++) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                return true;
            } catch (e: any) {
                if (attempt < EngineConfig.maxRetries) {
                    logger.warn(`NAV_RETRY [${attempt}/${EngineConfig.maxRetries}]: ${e.message}`);
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                }
            }
        }
        return false;
    }

    private async detectAuthWall(page: Page): Promise<boolean> {
        try {
            return await page.evaluate(() => {
                const currentUrl = window.location.href.toLowerCase();
                // LinkedIn has many "sign in" mentions even for logged-in pages; avoid false positives.
                if (currentUrl.includes('linkedin.com')) {
                    const hardAuthUrls = ['/login', '/checkpoint', '/uas/login'];
                    if (hardAuthUrls.some(s => currentUrl.includes(s))) return true;
                    const globalNav = document.querySelector('#global-nav, .global-nav, [data-test-global-nav]');
                    if (globalNav) return false;
                    const heading = (document.body.innerText || '').toLowerCase();
                    if (heading.includes('sign in to linkedin') || heading.includes('join linkedin')) return true;
                }

                const passInput = document.querySelector('input[type="password"]');
                if (passInput) {
                    const s = window.getComputedStyle(passInput);
                    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
                }
                const text = document.body.innerText.toLowerCase();
                const loginSignals = ['sign in', 'log in', 'join now'];
                const matchCount = loginSignals.filter(signal => text.includes(signal)).length;
                return matchCount >= 2 && document.querySelectorAll('input[type="text"], input[type="email"]').length < 2;
            });
        } catch {
            return false;
        }
    }

    private async fillField(
        page: Page,
        field: DetectedField,
        job: any,
        profile: any,
        isGoldMatch: boolean,
        existingCoverLetter: string,
        log: Record<string, string>
    ): Promise<{ coverLetter: string }> {
        const labelLower = field.label.toLowerCase();
        let coverLetter = existingCoverLetter;

        // File / Resume upload
        if (field.type === 'file' || labelLower.includes('resume') || labelLower.includes('cv')) {
            const resumePath = this.mapper.getResumePath();
            if (resumePath && fs.existsSync(resumePath)) {
                await page.setInputFiles(field.selector, resumePath);
                log[field.label] = '[RESUME_UPLOADED]';
            } else {
                logger.warn(`WORKER: Resume file not found at: ${resumePath}`);
            }
            return { coverLetter };
        }

        // Cover letter
        if (labelLower.includes('cover') || labelLower.includes('letter')) {
            if (!coverLetter) {
                if (isGoldMatch) {
                    logger.info('GOLD_TAILORING: Generating AI cover letter...');
                    coverLetter = await this.coverLetterAI.generate(job.title, job.company, job.description || job.title, profile);
                } else {
                    logger.info('SILVER_TEMPLATE: Using strategic template...');
                    coverLetter = this.mapper.getStrategicTemplate(job.title, 'cover_letter');
                }
            }
            await this.humanoid!.fillFast(field.selector, coverLetter || '');
            log[field.label] = '[COVER_LETTER_INJECTED]';
            return { coverLetter };
        }

        // Checkbox
        if (field.type === 'checkbox') {
            const forceAccept = /terms|conditions|privacy|consent|agree/i.test(labelLower);
            const ok = await this.robustCheckControl(page, field.selector, forceAccept);
            log[field.label] = ok ? '[CHECKED]' : '[CHECKBOX_FAILED]';
            return { coverLetter };
        }

        // Radio
        if (field.type === 'radio') {
            const ok = await this.robustCheckControl(page, field.selector);
            log[field.label] = ok ? '[RADIO_SELECTED]' : '[RADIO_FAILED]';
            return { coverLetter };
        }

        // AI custom question
        if (field.type === 'custom_question' || field.type === 'CUSTOM_QUESTION') {
            const aiAnswer = await this.questionSolver.solve(field.label, profile);
            if (aiAnswer) {
                await this.humanoid!.fillFast(field.selector, aiAnswer);
                log[field.label] = aiAnswer;
            }
            return { coverLetter };
        }

        // Select / Dropdown
        if (field.type === 'select') {
            const value = this.mapper.mapFieldToData(field.label, field.type);
            if (value) {
                const ok = await this.robustSelectControl(page, field.selector, value);
                log[field.label] = ok ? value : '[SELECT_FAILED]';
            }
            return { coverLetter };
        }

        // Standard text/email/tel/url/textarea
        const value = this.mapper.mapFieldToData(field.label, field.type);
        if (value) {
            if (field.type === 'textarea' || value.length > 100) {
                await this.humanoid!.fillFast(field.selector, value);
            } else {
                await this.humanoid!.typeOrganic(field.selector, value);
            }
            log[field.label] = value;
        }

        return { coverLetter };
    }

    private async robustCheckControl(page: Page, selector: string, forceAccept: boolean = false): Promise<boolean> {
        try {
            const el = await page.$(selector);
            if (!el) return false;
            await el.scrollIntoViewIfNeeded().catch(() => {});
            await page.check(selector).catch(() => {});
            const checked = await page.isChecked(selector).catch(() => false);
            if (checked) return true;

            // Fallback: click element or associated label.
            const clickedByMouse = await this.humanoid?.clickHandleOrganic(el, 'checkbox/radio');
            if (!clickedByMouse) await el.click({ force: true }).catch(() => {});
            const checkedAfter = await page.isChecked(selector).catch(() => false);
            if (checkedAfter) return true;

            const id = await el.getAttribute('id').catch(() => null);
            if (id) {
                const label = await page.$(`label[for="${id}"]`);
                if (label) {
                    const labelClicked = await this.humanoid?.clickHandleOrganic(label, 'label-check');
                    if (!labelClicked) await label.click({ force: true }).catch(() => {});
                    return await page.isChecked(selector).catch(() => false);
                }
            }

            // Terms acceptance fallback: click nearest consent label/container by text.
            if (forceAccept) {
                const accepted = await page.evaluate((sel) => {
                    const target = document.querySelector(sel) as HTMLInputElement | null;
                    if (!target) return false;
                    const wrappers: HTMLElement[] = [];
                    let node: HTMLElement | null = target.parentElement;
                    for (let i = 0; i < 4 && node; i++) {
                        wrappers.push(node);
                        node = node.parentElement;
                    }
                    const consentNode = wrappers.find(w => /terms|conditions|privacy|consent|agree/i.test((w.innerText || '').toLowerCase()));
                    if (consentNode) {
                        const lbl = consentNode.querySelector('label') as HTMLElement | null;
                        if (lbl) lbl.click();
                        else consentNode.click();
                    }
                    return target.checked;
                }, selector).catch(() => false);
                if (accepted) return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    private async robustSelectControl(page: Page, selector: string, value: string): Promise<boolean> {
        try {
            await this.humanoid!.selectOption(selector, value);
            const selected = await page.$eval(selector, (el) => {
                const s = el as HTMLSelectElement;
                return !!s.value;
            }).catch(() => false);
            if (selected) return true;

            // Fallback: click and type first letter / enter
            await page.click(selector).catch(() => {});
            if (value.length > 0) await page.keyboard.type(value[0]).catch(() => {});
            await page.keyboard.press('Enter').catch(() => {});
            return true;
        } catch {
            return false;
        }
    }

    private async openApplicationFormIfNeeded(page: Page): Promise<Page> {
        const applyPatterns = [
            /easy apply/i,
            /apply now/i,
            /^apply$/i,
            /start application/i,
            /continue application/i,
        ];

        const buttons = await page.$$('button, a[role="button"], a, input[type="button"], input[type="submit"]');
        for (const btn of buttons) {
            try {
                if (!(await btn.isVisible().catch(() => false))) continue;
                if (!(await btn.isEnabled().catch(() => true))) continue;
                const text = (await btn.innerText().catch(() => '')) || '';
                const value = (await btn.getAttribute('value').catch(() => '')) || '';
                const aria = (await btn.getAttribute('aria-label').catch(() => '')) || '';
                const combined = `${text} ${value} ${aria}`.trim();
                if (!combined) continue;
                if (!applyPatterns.some(p => p.test(combined))) continue;

                await btn.scrollIntoViewIfNeeded().catch(() => {});
                const clickedByMouse = await this.humanoid?.clickHandleOrganic(btn, combined);
                if (!clickedByMouse) {
                    await btn.click({ timeout: 3000 }).catch(async () => {
                        await btn.click({ force: true }).catch(() => {});
                    });
                }
                await page.waitForLoadState('domcontentloaded', { timeout: 7000 }).catch(() => {});
                await this.humanoid?.waitRandom(800, 1500);

                const pages = page.context().pages();
                if (pages.length > 1) {
                    const newest = pages[pages.length - 1];
                    if (newest !== page) {
                        await newest.bringToFront().catch(() => {});
                        await newest.waitForLoadState('domcontentloaded', { timeout: 7000 }).catch(() => {});
                        logger.info('WORKER: Switched to newly opened application tab.');
                        return newest;
                    }
                }
                logger.info(`WORKER: Opened application flow using "${combined.substring(0, 40)}"`);
                return page;
            } catch {
                continue;
            }
        }
        return page;
    }

    private detectPlatform(url: string): string {
        const u = (url || '').toLowerCase();
        if (u.includes('linkedin.com')) return 'LINKEDIN';
        if (u.includes('indeed.com')) return 'INDEED';
        if (u.includes('naukri.com')) return 'NAUKRI';
        return 'GENERIC';
    }

    private async openPlatformSpecificApplyFlow(page: Page, platform: string): Promise<Page> {
        const selectors = this.PLATFORM_APPLY_SELECTORS[platform] || [];
        if (selectors.length === 0) return page;

        for (const selector of selectors) {
            try {
                const btn = await page.$(selector);
                if (!btn) continue;
                if (!(await btn.isVisible().catch(() => false))) continue;
                await btn.scrollIntoViewIfNeeded().catch(() => {});
                const label = await btn.innerText().catch(() => platform + ' apply');
                const clickedByMouse = await this.humanoid?.clickHandleOrganic(btn, label || platform);
                if (!clickedByMouse) {
                    await btn.click({ timeout: 3000 }).catch(async () => {
                        await btn.click({ force: true }).catch(() => {});
                    });
                }
                await page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
                await this.humanoid?.waitRandom(600, 1200);

                const pages = page.context().pages();
                if (pages.length > 1) {
                    const newest = pages[pages.length - 1];
                    if (newest !== page) {
                        await newest.bringToFront().catch(() => {});
                        await newest.waitForLoadState('domcontentloaded', { timeout: 7000 }).catch(() => {});
                        logger.info(`STAGE: ${platform} apply opened in new tab.`);
                        return newest;
                    }
                }

                logger.info(`STAGE: ${platform} apply flow opened using ${selector}`);
                return page;
            } catch {
                continue;
            }
        }
        return page;
    }

    private classifyFailure(reason: string): string {
        const msg = (reason || '').toLowerCase();
        if (msg.includes('auth') || msg.includes('login') || msg.includes('sign in')) return `AUTH_REQUIRED: ${reason}`;
        if (msg.includes('captcha') || msg.includes('robot')) return `CAPTCHA_BLOCK: ${reason}`;
        if (msg.includes('required') || msg.includes('mandatory') || msg.includes('invalid')) return `VALIDATION_ERROR: ${reason}`;
        if (msg.includes('no form')) return `NO_FORM_FOUND: ${reason}`;
        if (msg.includes('timeout') || msg.includes('closed')) return `BROWSER_FLOW_ERROR: ${reason}`;
        if (msg.includes('submit')) return `SUBMIT_FAILED: ${reason}`;
        return `UNKNOWN_FAILURE: ${reason}`;
    }

    private async handleLinkedInEasyApply(page: Page, job: any, profile: any): Promise<{ handled: boolean; applied: boolean; reason?: string }> {
        const modalVisible = await page.locator('.jobs-easy-apply-modal, [aria-label*="Easy Apply"], [role="dialog"]').first().isVisible().catch(() => false);
        if (!modalVisible) return { handled: false, applied: false };

        logger.info(`LINKEDIN_EASY_APPLY: Workflow detected for ${job.company}.`);
        for (let step = 1; step <= 10; step++) {
            await this.humanoid?.waitRandom(600, 1200);
            await this.fillLinkedInModalFields(page, profile);

            // Final submit first
            const submitted = await this.clickLinkedInModalButton(page, [
                /submit application/i,
                /review/i
            ]);
            if (submitted) {
                await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
                const success = await page.evaluate(() => {
                    const text = (document.body.innerText || '').toLowerCase();
                    return text.includes('application submitted') || text.includes('your application was sent') || text.includes('done');
                }).catch(() => false);
                if (success) return { handled: true, applied: true };
            }

            // Continue workflow
            const moved = await this.clickLinkedInModalButton(page, [
                /^next$/i,
                /continue/i,
                /review/i
            ]);
            if (!moved) break;
        }
        return { handled: true, applied: false, reason: 'LINKEDIN_STEP_FLOW_INCOMPLETE' };
    }

    private async clickLinkedInModalButton(page: Page, patterns: RegExp[]): Promise<boolean> {
        const buttons = await page.$$('.jobs-easy-apply-modal button, [role="dialog"] button');
        for (const btn of buttons) {
            try {
                if (!(await btn.isVisible().catch(() => false))) continue;
                if (!(await btn.isEnabled().catch(() => false))) continue;
                const text = ((await btn.innerText().catch(() => '')) || '').trim();
                if (!patterns.some(p => p.test(text))) continue;
                const clickedByMouse = await this.humanoid?.clickHandleOrganic(btn, text);
                if (!clickedByMouse) {
                    await btn.click({ timeout: 3000 }).catch(async () => {
                        await btn.click({ force: true }).catch(() => {});
                    });
                }
                logger.info(`LINKEDIN_EASY_APPLY: Clicked "${text}"`);
                return true;
            } catch {
                continue;
            }
        }
        return false;
    }

    private async fillLinkedInModalFields(page: Page, profile: any): Promise<void> {
        const phone = profile?.contact_information?.phone_primary || '';
        const linkedin = profile?.online_profiles?.linkedin || '';
        const github = profile?.online_profiles?.github || '';
        const city = profile?.contact_information?.current_location || '';

        const textInputs = await page.$$('.jobs-easy-apply-modal input, [role="dialog"] input, .jobs-easy-apply-modal textarea');
        for (const input of textInputs.slice(0, 20)) {
            try {
                if (!(await input.isVisible().catch(() => false))) continue;
                if (!(await input.isEditable().catch(() => false))) continue;
                const name = ((await input.getAttribute('name').catch(() => '')) || '').toLowerCase();
                const id = ((await input.getAttribute('id').catch(() => '')) || '').toLowerCase();
                const aria = ((await input.getAttribute('aria-label').catch(() => '')) || '').toLowerCase();
                const placeholder = ((await input.getAttribute('placeholder').catch(() => '')) || '').toLowerCase();
                const hint = `${name} ${id} ${aria} ${placeholder}`;

                let value = '';
                if (/phone|mobile|contact/.test(hint)) value = phone;
                else if (/linkedin/.test(hint)) value = linkedin;
                else if (/github|portfolio|website/.test(hint)) value = github;
                else if (/city|location/.test(hint)) value = city;
                if (!value) continue;

                await input.click().catch(() => {});
                await page.keyboard.press('Control+a').catch(() => {});
                await page.keyboard.press('Delete').catch(() => {});
                await page.keyboard.type(value).catch(() => {});
                await this.humanoid?.waitRandom(120, 260);
            } catch {
                continue;
            }
        }

        // Handle LinkedIn select/radio style controls
        const selectors = await page.$$('.jobs-easy-apply-modal select, [role="dialog"] select');
        for (const sel of selectors) {
            try {
                if (!(await sel.isVisible().catch(() => false))) continue;
                const id = ((await sel.getAttribute('id').catch(() => '')) || '').toLowerCase();
                const name = ((await sel.getAttribute('name').catch(() => '')) || '').toLowerCase();
                const hint = `${id} ${name}`;
                let option = '';
                if (/authoriz|visa|sponsor/.test(hint)) option = 'No';
                else if (/experience|years/.test(hint)) option = String(profile?.salary_details?.total_experience || '2');
                else if (/notice|join/.test(hint)) option = String(profile?.availability?.notice_period || 'Immediately');
                if (!option) continue;
                await sel.selectOption({ label: option }).catch(async () => {
                    await sel.selectOption({ value: option }).catch(() => {});
                });
            } catch {
                continue;
            }
        }

        // Uncheck "Follow company" if present to avoid side-effects.
        const followCheckboxes = await page.$$('.jobs-easy-apply-modal input[type="checkbox"], [role="dialog"] input[type="checkbox"]');
        for (const cb of followCheckboxes) {
            try {
                const id = ((await cb.getAttribute('id').catch(() => '')) || '').toLowerCase();
                const name = ((await cb.getAttribute('name').catch(() => '')) || '').toLowerCase();
                const aria = ((await cb.getAttribute('aria-label').catch(() => '')) || '').toLowerCase();
                const hint = `${id} ${name} ${aria}`;
                if (!hint.includes('follow')) continue;
                const checked = await cb.isChecked().catch(() => false);
                if (checked) await cb.uncheck().catch(() => {});
            } catch {
                continue;
            }
        }

        // Always try resume upload input if present in modal
        const resumePath = this.mapper.getResumePath();
        if (resumePath && fs.existsSync(resumePath)) {
            const fileInputs = await page.$$('.jobs-easy-apply-modal input[type="file"], [role="dialog"] input[type="file"]');
            for (const fileInput of fileInputs) {
                await fileInput.setInputFiles(resumePath).catch(() => {});
            }
        }
    }

    private async handleIndeedApply(page: Page, profile: any): Promise<{ handled: boolean; applied: boolean; reason?: string }> {
        const isIndeed = page.url().toLowerCase().includes('indeed.com');
        if (!isIndeed) return { handled: false, applied: false };

        const applyVisible = await page.locator('button:has-text("Apply now"), a:has-text("Apply now"), button:has-text("Continue application")').first().isVisible().catch(() => false);
        if (!applyVisible) return { handled: false, applied: false };

        for (let step = 1; step <= 8; step++) {
            await this.fillCommonTextFields(page, profile);
            const clicked = await this.clickByText(page, [/apply now/i, /continue/i, /^next$/i, /review/i, /submit/i]);
            if (!clicked) break;
            await page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
            const success = await page.evaluate(() => {
                const t = (document.body.innerText || '').toLowerCase();
                return t.includes('application submitted') || t.includes('thanks for applying') || t.includes('you applied');
            }).catch(() => false);
            if (success) return { handled: true, applied: true };
        }
        return { handled: true, applied: false, reason: 'INDEED_STEP_FLOW_INCOMPLETE' };
    }

    private async handleNaukriApply(page: Page, profile: any): Promise<{ handled: boolean; applied: boolean; reason?: string }> {
        const isNaukri = page.url().toLowerCase().includes('naukri.com');
        if (!isNaukri) return { handled: false, applied: false };

        const applyVisible = await page.locator('button:has-text("Apply"), a:has-text("Apply"), button:has-text("Apply on company site")').first().isVisible().catch(() => false);
        if (!applyVisible) return { handled: false, applied: false };

        for (let step = 1; step <= 8; step++) {
            await this.fillCommonTextFields(page, profile);
            const clicked = await this.clickByText(page, [/apply/i, /continue/i, /^next$/i, /submit/i]);
            if (!clicked) break;
            await page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
            const success = await page.evaluate(() => {
                const t = (document.body.innerText || '').toLowerCase();
                return t.includes('application submitted') || t.includes('applied successfully') || t.includes('thank you');
            }).catch(() => false);
            if (success) return { handled: true, applied: true };
        }
        return { handled: true, applied: false, reason: 'NAUKRI_STEP_FLOW_INCOMPLETE' };
    }

    private async fillCommonTextFields(page: Page, profile: any): Promise<void> {
        const values: Record<string, string> = {
            phone: profile?.contact_information?.phone_primary || '',
            email: profile?.contact_information?.email || '',
            city: profile?.contact_information?.current_location || '',
            linkedin: profile?.online_profiles?.linkedin || '',
            github: profile?.online_profiles?.github || '',
        };
        const inputs = await page.$$('input, textarea');
        for (const input of inputs.slice(0, 30)) {
            try {
                if (!(await input.isVisible().catch(() => false))) continue;
                if (!(await input.isEditable().catch(() => false))) continue;
                const n = ((await input.getAttribute('name').catch(() => '')) || '').toLowerCase();
                const id = ((await input.getAttribute('id').catch(() => '')) || '').toLowerCase();
                const a = ((await input.getAttribute('aria-label').catch(() => '')) || '').toLowerCase();
                const p = ((await input.getAttribute('placeholder').catch(() => '')) || '').toLowerCase();
                const hint = `${n} ${id} ${a} ${p}`;
                let value = '';
                if (/phone|mobile|contact/.test(hint)) value = values.phone;
                else if (/email/.test(hint)) value = values.email;
                else if (/city|location/.test(hint)) value = values.city;
                else if (/linkedin/.test(hint)) value = values.linkedin;
                else if (/github|portfolio|website/.test(hint)) value = values.github;
                if (!value) continue;
                await input.click().catch(() => {});
                await page.keyboard.press('Control+a').catch(() => {});
                await page.keyboard.press('Delete').catch(() => {});
                await page.keyboard.type(value).catch(() => {});
            } catch {
                continue;
            }
        }
    }

    private async clickByText(page: Page, patterns: RegExp[]): Promise<boolean> {
        const buttons = await page.$$('button, a[role="button"], a, input[type="button"], input[type="submit"]');
        for (const btn of buttons) {
            try {
                if (!(await btn.isVisible().catch(() => false))) continue;
                if (!(await btn.isEnabled().catch(() => false))) continue;
                const text = `${(await btn.innerText().catch(() => '')) || ''} ${(await btn.getAttribute('value').catch(() => '')) || ''}`.trim();
                if (!patterns.some(p => p.test(text))) continue;
                const clickedByMouse = await this.humanoid?.clickHandleOrganic(btn, text);
                if (!clickedByMouse) await btn.click({ force: true }).catch(() => {});
                return true;
            } catch {
                continue;
            }
        }
        return false;
    }
}
