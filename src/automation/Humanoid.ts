import { Page } from 'playwright';
import logger from '../utils/logger';
import { EngineConfig } from '../utils/Config';

export class Humanoid {
    private page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    private getMultiplier() {
        if (EngineConfig.protocol === 'STEALTH') return 2.0;
        if (EngineConfig.protocol === 'TURBO') return 0.3;
        return 1.0;
    }

    /**
     * Subtle mouse jitter to mimic a resting hand
     */
    async jitterMouse() {
        const mult = this.getMultiplier();
        const xOffset = (Math.random() - 0.5) * 5 * mult;
        const yOffset = (Math.random() - 0.5) * 5 * mult;
        await this.page.mouse.move(100 + xOffset, 100 + yOffset).catch(() => {});
    }

    /**
     * Organic mouse movement using Bezier curves
     */
    async moveMouseOrganic(selector: string) {
        const mult = this.getMultiplier();
        try {
            const element = await this.page.$(selector);
            if (!element) return;

            const box = await element.boundingBox();
            if (!box) return;

            const targetX = box.x + box.width / 2;
            const targetY = box.y + box.height / 2;

            const startX = Math.random() * 1280;
            const startY = Math.random() * 720;

            const steps = Math.floor((15 + Math.floor(Math.random() * 10)) * mult);
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const midX = (startX + targetX) / 2 + (Math.random() - 0.5) * 200;
                const midY = (startY + targetY) / 2 + (Math.random() - 0.5) * 200;

                const x = Math.pow(1 - t, 2) * startX + 2 * (1 - t) * t * midX + Math.pow(t, 2) * targetX;
                const y = Math.pow(1 - t, 2) * startY + 2 * (1 - t) * t * midY + Math.pow(t, 2) * targetY;

                await this.page.mouse.move(x, y);
                await new Promise(r => setTimeout(r, (10 + Math.random() * 10) * mult));
            }

            await this.page.mouse.click(targetX, targetY);
        } catch (e) {
            await this.page.click(selector).catch(() => {});
        }
    }

    async clickHandleOrganic(element: any, label: string = ''): Promise<boolean> {
        const mult = this.getMultiplier();
        try {
            const box = await element.boundingBox();
            if (!box) return false;
            const targetX = box.x + (box.width * (0.35 + Math.random() * 0.3));
            const targetY = box.y + (box.height * (0.35 + Math.random() * 0.3));

            const steps = Math.max(10, Math.floor((12 + Math.random() * 10) * mult));
            const startX = Math.random() * 1200;
            const startY = Math.random() * 700;
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const x = startX + (targetX - startX) * t + (Math.random() - 0.5) * 4;
                const y = startY + (targetY - startY) * t + (Math.random() - 0.5) * 4;
                await this.page.mouse.move(x, y).catch(() => {});
                await new Promise(r => setTimeout(r, (8 + Math.random() * 14) * mult));
            }
            await this.page.mouse.down().catch(() => {});
            await new Promise(r => setTimeout(r, (40 + Math.random() * 80) * mult));
            await this.page.mouse.up().catch(() => {});
            if (label) logger.info(`HUMANOID: Mouse-clicked "${label.substring(0, 40)}"`);
            return true;
        } catch {
            return false;
        }
    }

    async clearAndFocus(selector: string): Promise<void> {
        await this.page.click(selector).catch(() => {});
        await this.page.keyboard.press('Control+a').catch(() => {});
        await this.page.keyboard.press('Delete').catch(() => {});
        await new Promise(r => setTimeout(r, 80));
    }

    /**
     * Organic typing with variable speed.
     * For short text (<80 chars) uses char-by-char. For long text uses fillFast.
     */
    async typeOrganic(selector: string, text: string) {
        if (!text) return;

        // Clear the field first to avoid appending
        try {
            await this.clearAndFocus(selector);
        } catch { }

        // For long content (cover letters, summaries), use fast fill then simulate a few keystrokes
        if (text.length > 80) {
            await this.fillFast(selector, text);
            return;
        }

        const mult = this.getMultiplier();
        await this.page.focus(selector);

        for (const char of text) {
            await this.page.keyboard.type(char);

            // Random delay scaled by protocol
            const delay = (30 + Math.random() * 80) * mult;
            await new Promise(r => setTimeout(r, delay));

            // Occasional longer pause (thinking)
            if (Math.random() > 0.97) {
                await new Promise(r => setTimeout(r, (400 + Math.random() * 800) * mult));
            }
        }
    }

    /**
     * Fast fill for long-form content — uses native fill then triggers input event.
     * Avoids spending 10 minutes typing a cover letter char-by-char.
     */
    async fillFast(selector: string, text: string) {
        try {
            await this.page.fill(selector, text);
            // Trigger React/Vue input events so the framework registers the change
            await this.page.evaluate((sel) => {
                const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement;
                if (el) {
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, selector);
            await new Promise(r => setTimeout(r, 200));
        } catch (err: any) {
            // Fallback to typeOrganic for React-controlled inputs that reject fill()
            logger.warn(`HUMANOID: fillFast failed for ${selector}, using keyboard: ${err.message}`);
            await this.page.focus(selector).catch(() => {});
            await this.page.keyboard.type(text.substring(0, 500)); // Cap at 500 chars
        }
    }

    /**
     * Handle <select> dropdowns by value or visible text
     */
    async selectOption(selector: string, valueOrText: string) {
        try {
            // Try by value first
            await this.page.selectOption(selector, { value: valueOrText }).catch(async () => {
                // Try by label text
                await this.page.selectOption(selector, { label: valueOrText }).catch(async () => {
                    // Try by index if it contains a number
                    if (/^\d+$/.test(valueOrText)) {
                        await this.page.selectOption(selector, { index: parseInt(valueOrText) });
                    }
                });
            });
            await new Promise(r => setTimeout(r, 200));
        } catch (err: any) {
            logger.warn(`HUMANOID: selectOption failed for ${selector}: ${err.message}`);
        }
    }

    async scrollOrganic() {
        const mult = this.getMultiplier();
        const scrolls = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < scrolls; i++) {
            const distance = 200 + Math.random() * 500;
            await this.page.mouse.wheel(0, distance).catch(() => {});
            await new Promise(r => setTimeout(r, (400 + Math.random() * 600) * mult));

            if (Math.random() > 0.7) await this.waitRandom(800 * mult, 2000 * mult);
        }
    }

    async waitRandom(min: number = 1000, max: number = 3000) {
        const mult = this.getMultiplier();
        const time = (Math.floor(Math.random() * (max - min)) + min) * mult;
        await new Promise(r => setTimeout(r, time));
    }
}
