import { Page } from 'playwright';
import logger from '../utils/logger';

export class Submitter {

    // Heuristic patterns for final submission buttons
    private submitPatterns = [
        /submit application/i,
        /send application/i,
        /^apply$/i,
        /^submit$/i,
        /apply now/i,
        /^send$/i,
        /complete application/i,
        /finish application/i,
        /^review & submit$/i,
        /^confirm & apply$/i,
    ];

    // Multi-page form patterns (Workday / Greenhouse / Lever style)
    private nextPatterns = [
        /^next$/i,
        /^continue$/i,
        /save and continue/i,
        /next step/i,
        /proceed/i,
    ];

    // Success confirmation indicators
    private successPatterns = [
        /application.*submitted/i,
        /thank you.*appl/i,
        /successfully applied/i,
        /your application.*received/i,
        /we.*received.*application/i,
        /application complete/i,
        /we will be in touch/i,
        /confirmation/i,
    ];

    /**
     * Attempts to submit the form with multi-page support (up to 6 steps).
     */
    async attemptSubmit(page: Page, maxSteps: number = 6): Promise<boolean> {
        logger.info('SUBMISSION: Looking for final action button...');

        try {
            for (let step = 1; step <= maxSteps; step++) {
                // Wait for any validation scripts to settle
                await new Promise(r => setTimeout(r, 1500));

                // Check if we already landed on a success page
                if (await this.isSuccessPage(page)) {
                    logger.info(`SUBMISSION: Success page detected at step ${step}.`);
                    return true;
                }

                // Try final submit button first
                const clickedSubmit = await this.clickButtonMatching(page, this.submitPatterns);
                if (clickedSubmit) {
                    logger.info(`SUBMISSION: Final Submit Button clicked at step ${step}. Verifying...`);
                    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
                    await new Promise(r => setTimeout(r, 2000));

                    // Verify submission succeeded
                    if (await this.isSuccessPage(page)) {
                        logger.info('SUBMISSION: ✅ Application confirmed submitted!');
                        return true;
                    }
                    // Still on same page — maybe there are more steps
                    logger.warn('SUBMISSION: Submit clicked but no success page. Checking for next step...');
                }

                // Try "Next" button for multi-page forms
                const clickedNext = await this.clickButtonMatching(page, this.nextPatterns);
                if (clickedNext) {
                    logger.info(`SUBMISSION: Multi-page form — clicked NEXT at step ${step}/${maxSteps}.`);
                    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
                    await new Promise(r => setTimeout(r, 1500));
                    continue;
                }

                // Nothing was clicked — exit loop
                if (!clickedSubmit && !clickedNext) {
                    logger.warn(`SUBMISSION: No actionable button found at step ${step}. Halting.`);
                    break;
                }
            }

            // Final success check after all steps
            if (await this.isSuccessPage(page)) {
                return true;
            }

            logger.warn('SUBMISSION: Could not confidently complete submission after all steps.');
            return false;
        } catch (e: any) {
            logger.error(`SUBMISSION ERROR: ${e.message}`);
            return false;
        }
    }

    /**
     * Checks if the current page shows a submission success message.
     */
    private async isSuccessPage(page: Page): Promise<boolean> {
        try {
            const pageText = await page.innerText('body').catch(() => '');
            return this.successPatterns.some(p => p.test(pageText));
        } catch {
            return false;
        }
    }

    private async clickButtonMatching(page: Page, patterns: RegExp[]): Promise<boolean> {
        // Query all clickable elements
        const buttons = await page.$$('button, input[type="submit"], input[type="button"], a[role="button"], [type="submit"]');

        for (const btn of buttons) {
            try {
                const isVisible = await btn.isVisible();
                if (!isVisible) continue;

                const isEnabled = await btn.isEnabled().catch(() => true);
                if (!isEnabled) continue;

                const text = await btn.innerText().catch(() => '');
                const value = await btn.getAttribute('value').catch(() => '') || '';
                const ariaLabel = await btn.getAttribute('aria-label').catch(() => '') || '';
                const combinedText = `${text} ${value} ${ariaLabel}`.trim();

                for (const pattern of patterns) {
                    if (pattern.test(combinedText)) {
                        await btn.scrollIntoViewIfNeeded().catch(() => {});
                        
                        // Ensure it's not obscured and actually clickable
                        const isClickable = await btn.isEnabled().catch(() => false);
                        if (!isClickable) {
                             logger.warn(`SUBMISSION: Button "${combinedText.substring(0, 30)}" found but disabled. Waiting...`);
                             await new Promise(r => setTimeout(r, 2000));
                             if (!(await btn.isEnabled().catch(() => false))) continue;
                        }

                        await btn.hover().catch(() => {});
                        await new Promise(r => setTimeout(r, 500));

                        // Try real user-style click first, then keyboard Enter/Space fallback.
                        const clicked = await btn.click({ timeout: 5000 }).then(() => true).catch(() => false);
                        if (!clicked) {
                            await btn.focus().catch(() => {});
                            const pressed = await page.keyboard.press('Enter').then(() => true).catch(() => false);
                            if (!pressed) {
                                await page.keyboard.press('Space').catch(() => {});
                                await btn.click({ force: true }).catch(() => {});
                            }
                        }
                        
                        logger.info(`SUBMISSION: Successfully triggered "${combinedText.substring(0, 40)}"`);
                        return true;
                    }
                }
            } catch {
                // Skip unclickable buttons
            }
        }
        return false;
    }
}
