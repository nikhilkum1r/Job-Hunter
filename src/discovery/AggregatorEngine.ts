import axios from 'axios';
import { Page } from 'playwright';
import logger from '../utils/logger';
import { dbManager } from '../db/DBManager';

export class AggregatorEngine {
    // Job aggregator sites that are NOT direct application links
    private blacklist = [
        'linkedin.com', 'indeed.com', 'glassdoor.com', 'simplyhired.com', 'ziprecruiter.com',
        'dice.com', 'jooble.org', 'workingnomads.com', 'flexjobs.com', 'monster.com',
        'careerbuilder.com', 'lensa.com', 'talent.com', 'upwork.com', 'fiverr.com',
        'naukri.com', 'shine.com', 'timesjobs.com', 'foundit.in'
    ];

    // Multiple selector fallbacks for DuckDuckGo result links
    private readonly DDG_SELECTORS = [
        'a[data-testid="result-title-a"]',
        'h2 a[href]',
        'article a[href]',
        '.result__a',
        '.result__title a',
    ];

    async discover(query: string, page?: Page, sourceFilter: string = 'ALL') {
        logger.info(`AGGREGATOR: Targeted crawl [${sourceFilter}] for "${query}"...`);

        try {
            // Parallel API discovery
            let apiResults: any[] = [];
            if (sourceFilter === 'ALL' || sourceFilter === 'API') {
                apiResults = (await Promise.allSettled([
                    this.fetchRemotive(query),
                    this.fetchTheMuse(query),
                    this.fetchArbeitnow(query),
                    this.fetchRemoteOK(query),
                ])).filter(r => r.status === 'fulfilled')
                  .map(r => (r as PromiseFulfilledResult<any[]>).value)
                  .flat();
            }

            // Browser dorking
            let dorkResults: any[] = [];
            if (page && sourceFilter !== 'API') {
                dorkResults = await this.discoverViaUniversalDorks(query, page, sourceFilter);
            }

            const flatResults = [...apiResults, ...dorkResults];

            // Deduplicate by URL
            const uniqueMap = new Map<string, any>();
            for (const job of flatResults) {
                if (job.url && !uniqueMap.has(job.url)) {
                    uniqueMap.set(job.url, job);
                }
            }

            // Filter by keyword relevance
            const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            const relevantJobs = [...uniqueMap.values()].filter(job => {
                const title = (job.title || '').toLowerCase();
                const isTechJob = /engineer|developer|software|data|analyst|designer|devops|security|machine|intern/i.test(title);
                const matchesQuery = queryWords.some(word => title.includes(word));
                if (job.source === 'GlobalDork') {
                    const url = (job.url || '').toLowerCase();
                    const isDirectLink = /\/jobs\/|\/apply|\/careers\/|\/vacancy\/|\/job\/|lever\.co|greenhouse\.io|smartrecruiters|workable\.com|bamboohr\.com/.test(url);
                    return (matchesQuery || isTechJob) && isDirectLink;
                }
                return matchesQuery || isTechJob;
            });

            let saved = 0;
            for (const job of relevantJobs) {
                const result = dbManager.saveJob(job);
                if (result?.changes > 0) saved++;
            }

            logger.info(`AGGREGATOR: Discovered ${flatResults.length} raw → ${relevantJobs.length} relevant → ${saved} new jobs saved.`);
        } catch (error: any) {
            logger.error('Aggregator crawl error:', error.message);
        }
    }

    private async discoverViaUniversalDorks(query: string, page: Page, sourceFilter: string) {
        const dorkResults: any[] = [];

        const sourceMap: { [key: string]: string[] } = {
            'LINKEDIN': [
                `site:linkedin.com/jobs "${query}"`,
                `"${query}" "Apply on LinkedIn"`,
            ],
            'INDEED': [
                `site:indeed.com "${query}" jobs`,
                `"${query}" "Apply on Indeed"`,
            ],
            'NAUKRI': [
                `site:naukri.com "${query}"`,
                `"${query}" Jobs naukri.com`,
            ],
            'WELLFOUND': [
                `site:wellfound.com "${query}"`,
                `"${query}" startup hiring wellfound`,
            ],
            'INTERNSHALA': [
                `site:internshala.com "${query}"`,
                `"${query}" internship internshala`,
            ],
            'DIRECT': [
                `site:lever.co "${query}"`,
                `site:greenhouse.io "${query}"`,
                `site:smartrecruiters.com "${query}"`,
                `site:workable.com "${query}"`,
                `site:bamboohr.com "${query}"`,
                `"${query}" "careers@" email apply`,
            ],
        };

        let finalFilter = sourceFilter.toUpperCase();

        if (finalFilter === 'RANDOM') {
            const keys = Object.keys(sourceMap);
            finalFilter = keys[Math.floor(Math.random() * keys.length)];
            logger.info(`RANDOM_MODE: Selected source: ${finalFilter}`);
        }

        // In LinkedIn-only mode, use direct LinkedIn jobs search first (logged-in session).
        if (finalFilter === 'LINKEDIN') {
            const liResults = await this.discoverLinkedInDirect(query, page);
            if (liResults.length > 0) return liResults;
            logger.warn('LINKEDIN_DIRECT: No direct jobs found; strict LinkedIn mode returns no fallback dorks.');
            return [];
        }

        let selectedDorks: string[];
        if (finalFilter === 'ALL') {
            selectedDorks = Object.values(sourceMap).flat().sort(() => Math.random() - 0.5).slice(0, 6);
        } else if (sourceMap[finalFilter]) {
            selectedDorks = sourceMap[finalFilter];
        } else {
            selectedDorks = [`"${query}" "Apply Now" site:lever.co OR site:greenhouse.io`];
        }

        for (const dork of selectedDorks) {
            try {
                const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(dork)}&t=h_&ia=web`;
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500));

                // Try multiple selectors for resilience
                let results: { url: string; title: string }[] = [];
                for (const selector of this.DDG_SELECTORS) {
                    try {
                        results = await page.$$eval(selector, (els) =>
                            els.slice(0, 10).map(a => ({
                                url: (a as HTMLAnchorElement).href,
                                title: ((a as HTMLElement).innerText || (a as HTMLElement).textContent || '').trim()
                            }))
                        );
                        if (results.length > 0) break;
                    } catch { continue; }
                }

                // Harvest company emails from page text
                const pageText = await page.innerText('body').catch(() => '');
                this.harvestContacts(pageText, query);

                for (const link of results) {
                    const isSpam = this.shouldSkipLink(link.url, finalFilter);
                    if (link.url && link.url.startsWith('http') && !isSpam && link.title) {
                        dorkResults.push({
                            id: `dork-${Buffer.from(link.url).toString('base64').substring(0, 16)}`,
                            title: link.title.substring(0, 120),
                            company: this.extractCompanyName(link.url),
                            url: link.url,
                            source: 'GlobalDork',
                            salary: 'N/A',
                            location: 'Worldwide',
                            postedDate: new Date().toISOString()
                        });
                    }
                }

                // Polite delay between dorks
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
            } catch (e: any) {
                logger.warn(`Dork failure: "${dork}" — ${e.message}`);
            }
        }

        return dorkResults;
    }

    private async discoverLinkedInDirect(query: string, page: Page): Promise<any[]> {
        try {
            const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&f_AL=true`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2500);

            const links = await page.$$eval('a[href*="/jobs/view/"]', (els) => {
                const unique = new Map<string, { url: string; title: string }>();
                for (const el of els) {
                    const a = el as HTMLAnchorElement;
                    const href = a.href || '';
                    if (!href.includes('/jobs/view/')) continue;
                    const title = (a.innerText || a.textContent || '').trim();
                    const normalized = href.split('?')[0];
                    if (!unique.has(normalized)) {
                        unique.set(normalized, { url: normalized, title });
                    }
                    if (unique.size >= 40) break;
                }
                return Array.from(unique.values());
            }).catch(() => []);

            const jobs = links
                .filter(l => l.url && l.title)
                .map((l, idx) => ({
                    id: `linkedin-${Buffer.from(l.url).toString('base64').substring(0, 16)}-${idx}`,
                    title: l.title.substring(0, 140),
                    company: this.extractCompanyName(l.url),
                    url: l.url,
                    source: 'LinkedInDirect',
                    salary: 'N/A',
                    location: 'N/A',
                    postedDate: new Date().toISOString(),
                }));

            logger.info(`LINKEDIN_DIRECT: harvested ${jobs.length} job links from LinkedIn search.`);
            return jobs;
        } catch (e: any) {
            logger.warn(`LINKEDIN_DIRECT failed: ${e.message}`);
            return [];
        }
    }

    // ── API SOURCES ──────────────────────────────────────────────────────────────

    private async fetchRemotive(query: string): Promise<any[]> {
        try {
            const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=20`;
            const { data } = await axios.get(url, { timeout: 10000 });
            return (data.jobs || []).map((j: any) => ({
                id: `remotive-${j.id}`,
                title: j.title,
                company: j.company_name,
                url: j.url,
                source: 'Remotive',
                salary: j.salary || 'N/A',
                location: j.candidate_required_location || 'Remote',
                postedDate: j.publication_date,
                description: j.description ? j.description.replace(/<[^>]+>/g, '').substring(0, 500) : null
            }));
        } catch { return []; }
    }

    private async fetchTheMuse(query: string): Promise<any[]> {
        try {
            const page = Math.floor(Math.random() * 5) + 1;
            const url = `https://www.themuse.com/api/public/jobs?category=Software+Engineering&page=${page}`;
            const { data } = await axios.get(url, { timeout: 10000 });
            return (data.results || []).map((j: any) => ({
                id: `themuse-${j.id}`,
                title: j.name,
                company: j.company.name,
                url: j.refs.landing_page,
                source: 'TheMuse',
                salary: 'N/A',
                location: j.locations?.[0]?.name || 'USA/Remote',
                postedDate: j.publication_date
            }));
        } catch { return []; }
    }

    private async fetchArbeitnow(query: string): Promise<any[]> {
        try {
            const { data } = await axios.get('https://www.arbeitnow.com/api/job-board-api', { timeout: 10000 });
            return (data.data || []).slice(0, 20).map((j: any) => ({
                id: `arbeitnow-${j.slug}`,
                title: j.title,
                company: j.company_name,
                url: j.url,
                source: 'Arbeitnow',
                salary: 'N/A',
                location: j.location || 'Europe/Remote',
                postedDate: new Date().toISOString()
            }));
        } catch { return []; }
    }

    private async fetchRemoteOK(query: string): Promise<any[]> {
        try {
            const { data } = await axios.get('https://remoteok.com/api', {
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)' }
            });
            // First item is metadata, skip it
            const jobs = Array.isArray(data) ? data.slice(1) : [];
            const queryLower = query.toLowerCase();
            return jobs
                .filter((j: any) => {
                    const text = `${j.position || ''} ${(j.tags || []).join(' ')}`.toLowerCase();
                    return text.includes(queryLower) || queryLower.split(' ').some((w: string) => text.includes(w));
                })
                .slice(0, 15)
                .map((j: any) => ({
                    id: `remoteok-${j.id || j.slug}`,
                    title: j.position,
                    company: j.company,
                    url: j.url || `https://remoteok.com/l/${j.slug}`,
                    source: 'RemoteOK',
                    salary: j.salary_min ? `$${j.salary_min}-$${j.salary_max}` : 'N/A',
                    location: 'Remote Worldwide',
                    postedDate: j.date || new Date().toISOString()
                }));
        } catch { return []; }
    }

    // ── UTILITIES ────────────────────────────────────────────────────────────────

    private extractCompanyName(url: string): string {
        try {
            const urlObj = new URL(url);
            let slug = '';

            if (url.includes('lever.co')) slug = urlObj.pathname.split('/')[1];
            else if (url.includes('greenhouse.io')) slug = urlObj.pathname.split('/')[1];
            else if (url.includes('myworkdayjobs.com')) slug = urlObj.hostname.split('.')[0];
            else if (url.includes('workable.com') || url.includes('bamboohr.com')) slug = urlObj.hostname.split('.')[0];
            else if (url.includes('smartrecruiters.com')) slug = urlObj.pathname.split('/')[1];
            else {
                const parts = urlObj.hostname.replace('www.', '').split('.');
                slug = parts.length > 1 ? parts[0] : parts[0];
            }

            if (!slug || slug.length < 2) return 'Direct Company';
            return slug.split(/[-_.]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        } catch {
            return 'Direct Company';
        }
    }

    private shouldSkipLink(url: string, sourceFilter: string): boolean {
        const lower = (url || '').toLowerCase();
        const allowMap: Record<string, string[]> = {
            LINKEDIN: ['linkedin.com'],
            INDEED: ['indeed.com'],
            NAUKRI: ['naukri.com'],
            WELLFOUND: ['wellfound.com'],
            INTERNSHALA: ['internshala.com'],
        };
        const allowedDomains = allowMap[sourceFilter] || [];
        if (allowedDomains.some(d => lower.includes(d))) return false;
        return this.blacklist.some(site => lower.includes(site));
    }

    private harvestContacts(text: string, query: string) {
        const emailRegex = /[a-zA-Z0-9._%+-]+@(?!gmail\.|yahoo\.|hotmail\.|outlook\.|proton\.)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const matches = text.match(emailRegex);
        if (matches) {
            const unique = [...new Set(matches)];
            for (const email of unique) {
                dbManager.saveContact({
                    email,
                    source: `Discovery: ${query}`,
                    interactionHistory: JSON.stringify([{ date: new Date().toISOString(), type: 'DISCOVERED' }])
                });
            }
        }
    }
}
