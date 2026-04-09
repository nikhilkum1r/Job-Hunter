import logger from '../utils/logger';
import * as cheerio from 'cheerio';

export interface DetectedField {
    label: string;
    selector: string;
    type: string;
}

export class FieldDetector {
    async analyzePage(html: string, url: string): Promise<DetectedField[]> {
        // TIER 1: HEURISTIC DETECTION (0 tokens)
        const heuristicFields = this.analyzeHeuristics(html);
        const filteredFields = this.filterOutLikelyLoginFields(heuristicFields, html);

        // Quality gate: do we have the core fields for a standard application?
        const hasEmail = filteredFields.some(f => /email/i.test(f.label));
        const hasName  = filteredFields.some(f => /name/i.test(f.label));
        const hasSomething = filteredFields.length >= 2;

        if (hasSomething && (hasEmail || hasName)) {
            logger.info(`FIELD DETECTION: Heuristic Success — ${filteredFields.length} fields mapped. No AI tokens consumed.`);
            return filteredFields;
        }

        // Deterministic mode: no AI fallback to avoid quota failures and latency.
        if (process.env.ENABLE_AI !== 'true') {
            logger.info(`FIELD DETECTION: Heuristics weak (${filteredFields.length} fields). Deterministic mode active.`);
            return filteredFields;
        }

        return filteredFields;
    }

    private analyzeHeuristics(html: string): DetectedField[] {
        const $ = cheerio.load(html);
        const fields: DetectedField[] = [];
        const seen = new Set<string>();

        // Extended dictionary covering 30+ common patterns across major ATS portals
        const dictionary = [
            // Personal
            { pattern: /first[_\-\s]?name|given[_\-\s]?name|fname/i,          label: 'First Name',       type: 'text' },
            { pattern: /last[_\-\s]?name|family[_\-\s]?name|surname|lname/i,   label: 'Last Name',        type: 'text' },
            { pattern: /full[_\-\s]?name|^name$|your[_\-\s]?name/i,            label: 'Full Name',        type: 'text' },
            { pattern: /gender|sex\b|identify.*man|identify.*woman/i,            label: 'Gender',           type: 'select' },
            { pattern: /date[_\-\s]?of[_\-\s]?birth|dob\b|birth[_\-\s]?date/i, label: 'Date of Birth',   type: 'text' },
            { pattern: /nationality|citizenship/i,                               label: 'Nationality',      type: 'text' },
            { pattern: /ethnicity|race|origin/i,                                 label: 'Ethnicity',        type: 'select' },

            // Contact
            { pattern: /email|e-mail/i,                                          label: 'Email',            type: 'email' },
            { pattern: /phone|telephone|mobile|contact[_\-\s]?number|cell/i,    label: 'Phone',            type: 'tel' },
            { pattern: /alternate[_\-\s]?phone|secondary[_\-\s]?phone/i,        label: 'Alternate Phone',  type: 'tel' },
            { pattern: /^city$|current[_\-\s]?city/i,                           label: 'City',             type: 'text' },
            { pattern: /^state$|province/i,                                      label: 'State',            type: 'text' },
            { pattern: /^country$/i,                                             label: 'Country',          type: 'text' },
            { pattern: /zip|postal|pin[_\-\s]?code/i,                           label: 'Zip Code',         type: 'text' },
            { pattern: /address|street/i,                                        label: 'Address',          type: 'text' },
            { pattern: /relocat/i,                                               label: 'Willing to Relocate', type: 'select' },

            // Online Profiles
            { pattern: /linkedin/i,                                              label: 'LinkedIn',         type: 'url' },
            { pattern: /github|git[_\-\s]?hub/i,                                label: 'GitHub',           type: 'url' },
            { pattern: /portfolio|personal[_\-\s]?site|website/i,               label: 'Portfolio',        type: 'url' },
            { pattern: /leetcode/i,                                              label: 'LeetCode',         type: 'url' },
            { pattern: /hackerrank/i,                                            label: 'HackerRank',       type: 'url' },

            // Work
            { pattern: /current[_\-\s]?company|employer|organization/i,         label: 'Current Company',  type: 'text' },
            { pattern: /current[_\-\s]?(title|role|position)|job[_\-\s]?title/i,label: 'Current Title',    type: 'text' },
            { pattern: /years?[_\-\s]?of[_\-\s]?exp|total[_\-\s]?exp|exp[_\-\s]?years?/i, label: 'Years of Experience', type: 'text' },
            { pattern: /notice[_\-\s]?period|when[_\-\s]?(can|will)[_\-\s]?you[_\-\s]?join|availab/i, label: 'Notice Period', type: 'text' },

            // Education
            { pattern: /college|university|institution|school[_\-\s]?name/i,    label: 'University',       type: 'text' },
            { pattern: /^degree$|qualification/i,                               label: 'Degree',            type: 'text' },
            { pattern: /major|field[_\-\s]?of[_\-\s]?study|specializ/i,        label: 'Major',            type: 'text' },
            { pattern: /graduation[_\-\s]?year|year[_\-\s]?of[_\-\s]?grad|pass[_\-\s]?out/i, label: 'Graduation Year', type: 'text' },
            { pattern: /gpa|cgpa|percentage|marks/i,                            label: 'GPA/CGPA',         type: 'text' },

            // Salary
            { pattern: /expected[_\-\s]?salary|desired[_\-\s]?salary/i,        label: 'Expected Salary',  type: 'text' },
            { pattern: /current[_\-\s]?salary|present[_\-\s]?salary/i,         label: 'Current Salary',   type: 'text' },

            // Legal / Authorization
            { pattern: /work[_\-\s]?authoriz|right[_\-\s]?to[_\-\s]?work|visa[_\-\s]?status/i, label: 'Work Authorization', type: 'select' },
            { pattern: /require[_\-\s]?sponsor|visa[_\-\s]?sponsor/i,          label: 'Require Sponsorship', type: 'select' },
            { pattern: /us[_\-\s]?citizen/i,                                    label: 'US Citizen',       type: 'select' },
            { pattern: /disability|disabled/i,                                  label: 'Disability',       type: 'select' },
            { pattern: /veteran|military/i,                                     label: 'Veteran Status',    type: 'select' },
            { pattern: /terms|conditions|privacy|consent|i agree|accept/i,      label: 'Terms Acceptance', type: 'checkbox' },

            // Files
            { pattern: /resume|cv\b|curriculum/i,                               label: 'Resume',           type: 'file' },
            { pattern: /cover[_\-\s]?letter/i,                                  label: 'Cover Letter',     type: 'textarea' },

            // Screening
            { pattern: /how[_\-\s]?did[_\-\s]?you[_\-\s]?hear|source|referral/i, label: 'How did you hear', type: 'select' },
            { pattern: /why[_\-\s]?interested|why[_\-\s]?apply|why[_\-\s]?company/i, label: 'Why Interested', type: 'textarea' },
            { pattern: /message|additional[_\-\s]?info|anything[_\-\s]?else/i, label: 'Additional Info',   type: 'textarea' },
        ];

        // Helper: build a stable selector for an element
        const buildSelector = ($el: cheerio.Cheerio<any>): string => {
            const id = $el.attr('id');
            const name = $el.attr('name');
            const testId = $el.attr('data-testid') || $el.attr('data-test-id');
            const ariaLabel = $el.attr('aria-label');
            const placeholder = $el.attr('placeholder');

            if (id) return `#${id.replace(/[^\w-]/g, '_')}`;
            if (testId) return `[data-testid="${testId}"]`;
            if (name) return `[name="${name}"]`;
            if (ariaLabel) return `[aria-label="${ariaLabel}"]`;
            if (placeholder) return `[placeholder="${placeholder}"]`;
            return '';
        };

        // Strategy 1: Scan inputs, textareas, selects by their attributes
        $('input, textarea, select').each((_idx: number, el: any) => {
            const $el = $(el);
            const tagName = (el.tagName || el.name || '').toLowerCase();
            const inputType = $el.attr('type') || '';

            // Skip hidden, submit, button types
            if (['hidden', 'submit', 'button', 'reset', 'image'].includes(inputType)) return;

            const name = $el.attr('name') || '';
            const id = $el.attr('id') || '';
            const placeholder = $el.attr('placeholder') || '';
            const ariaLabel = $el.attr('aria-label') || '';
            const dataLabel = $el.attr('data-label') || '';
            const title = $el.attr('title') || '';

            const combinedString = `${name} ${id} ${placeholder} ${ariaLabel} ${dataLabel} ${title}`;

            for (const item of dictionary) {
                if (item.pattern.test(combinedString)) {
                    const selector = buildSelector($el);
                    if (!selector || seen.has(selector)) break;
                    seen.add(selector);

                    let type = item.type;
                    if (tagName === 'textarea') type = 'textarea';
                    else if (tagName === 'select') type = 'select';
                    else if (inputType === 'file') type = 'file';
                    else if (inputType === 'checkbox') type = 'checkbox';
                    else if (inputType === 'radio') type = 'radio';

                    fields.push({ label: item.label, selector, type });
                    break;
                }
            }
        });

        // Strategy 2: Scan <label> tags and find their associated inputs
        $('label').each((_idx: number, el: any) => {
            const $label = $(el);
            const labelText = $label.text().trim();
            if (!labelText || labelText.length > 80) return;

            for (const item of dictionary) {
                if (item.pattern.test(labelText)) {
                    let $input: cheerio.Cheerio<any> | null = null;

                    // for= attribute
                    const forAttr = $label.attr('for');
                    if (forAttr) {
                        $input = $(`#${forAttr}`);
                    }
                    // Nested input
                    if (!$input || $input.length === 0) {
                        $input = $label.find('input, textarea, select').first();
                    }

                    if ($input && $input.length > 0) {
                        const selector = buildSelector($input);
                        if (!selector || seen.has(selector)) break;
                        seen.add(selector);

                        const tagName = ($input[0].tagName || $input[0].name || '').toLowerCase();
                        const inputType = $input.attr('type') || '';
                        let type = item.type;
                        if (tagName === 'textarea') type = 'textarea';
                        else if (tagName === 'select') type = 'select';
                        else if (inputType === 'file') type = 'file';
                        else if (inputType === 'checkbox') type = 'checkbox';
                        else if (inputType === 'radio') type = 'radio';

                        fields.push({ label: item.label, selector, type });
                    }
                    break;
                }
            }
        });

        // Deduplicate by selector
        return Array.from(new Map(fields.map(f => [f.selector, f])).values());
    }

    private filterOutLikelyLoginFields(fields: DetectedField[], html: string): DetectedField[] {
        const lower = html.toLowerCase();
        const hasLoginSignals = /sign in|log in|forgot password|remember me/.test(lower);
        const hasPasswordField = /type=["']password["']/.test(lower);
        const hasApplySignals = /apply|application|resume|cv|cover letter|work authorization/.test(lower);

        if (!hasPasswordField) return fields;
        if (hasApplySignals) return fields;

        if (hasLoginSignals) {
            logger.info('FIELD DETECTION: Login form signals detected; filtering non-application fields.');
            return fields.filter(f => /terms acceptance|work authorization|resume|cover letter/i.test(f.label));
        }
        return fields;
    }

}
