import { Page } from 'playwright';
import { RichProfile } from './DataMapper';
import logger from '../utils/logger';

export class SelfHealer {
    async analyzeFailure(page: Page, profile: RichProfile): Promise<string | null> {
        logger.info('SELF-HEALER: Analyzing submission failure...');

        try {
            // 1. Extract visible error text
            const pageText = await page.innerText('body').catch(() => '');

            // 2. Try to find validation error elements (common patterns)
            const errorTexts: string[] = [];
            const errorSelectors = [
                '[class*="error"]',
                '[class*="invalid"]',
                '[class*="alert"]',
                '[aria-invalid="true"]',
                '[role="alert"]',
                '.field-error',
                '.form-error',
                '.validation-message'
            ];

            for (const sel of errorSelectors) {
                try {
                    const els = await page.$$(sel);
                    for (const el of els.slice(0, 5)) {
                        const txt = await el.innerText().catch(() => '');
                        if (txt && txt.trim().length > 2 && txt.length < 200) {
                            errorTexts.push(txt.trim());
                        }
                    }
                } catch { continue; }
            }

            // 3. Also extract error snippets from body text
            const regexMatches = pageText
                .match(/(error|required|invalid|failed|missing|incorrect|please\s+fill|must\s+be).{0,80}/gi) || [];
            errorTexts.push(...regexMatches.slice(0, 8));

            const uniqueErrors = [...new Set(errorTexts)].slice(0, 10);

            if (uniqueErrors.length === 0) {
                return 'Submit button found but no visible errors detected. Page may require manual review.';
            }

            logger.info(`SELF-HEALER: Found ${uniqueErrors.length} error signals.`);

            // For simple/obvious errors, don't burn AI tokens
            for (const err of uniqueErrors) {
                if (/phone|mobile|tel/i.test(err)) return 'Missing or invalid phone number';
                if (/email/i.test(err)) return 'Invalid email address';
                if (/resume|cv|attach/i.test(err)) return 'Resume file not attached or wrong format';
                if (/required|mandatory/i.test(err)) return `Required field missing: ${err.substring(0, 60)}`;
                if (/captcha|robot/i.test(err)) return 'CAPTCHA challenge detected — manual intervention needed';
            }

            // Deterministic diagnosis for complex failures.
            const normalized = uniqueErrors.map(e => e.toLowerCase()).join(' | ');
            if (/otp|verification|verify/.test(normalized)) return 'Verification step required before submit';
            if (/captcha|robot/.test(normalized)) return 'CAPTCHA challenge detected — manual intervention needed';
            if (/upload|file|resume|cv/.test(normalized)) return 'File upload validation failed';
            if (/terms|privacy|consent|agree/.test(normalized)) return 'Consent checkbox may be required';
            if (/format|invalid/.test(normalized)) return `Validation failed: ${uniqueErrors[0].substring(0, 80)}`;
            return `Submission blocked: ${uniqueErrors[0].substring(0, 100)}`;
        } catch (error: any) {
            logger.error('SelfHealer analysis failed:', error.message);
            return 'Unknown submission failure — manual review recommended';
        }
    }
}
