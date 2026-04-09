import axios from 'axios';
import { Page } from 'playwright';
import logger from '../utils/logger';
import { dbManager } from '../db/DBManager';

/**
 * UniversalEngine — Standalone discovery engine.
 * Used for simple single-cycle discovery (not the full aggregator loop).
 */
export class UniversalEngine {
    private blacklist = [
        'linkedin.com', 'indeed.com', 'glassdoor.com', 'simplyhired.com', 'ziprecruiter.com',
        'dice.com', 'jooble.org', 'workingnomads.com', 'flexjobs.com', 'monster.com',
        'careerbuilder.com', 'lensa.com', 'talent.com', 'upwork.com', 'fiverr.com'
    ];

    // Multiple selector fallbacks for DuckDuckGo result links
    private readonly DDG_SELECTORS = [
        'a[data-testid="result-title-a"]',
        'h2 a[href]',
        'article a[href]',
        '.result__a',
        '.result__title a',
    ];

    async discover(query: string, page: Page) {
        logger.info(`UNIVERSAL_ENGINE: Initiating global scan for "${query}"...`);

        try {
            // 1. Parallel API discovery
            const settled = await Promise.allSettled([
                this.fetchRemotive(query),
                this.fetchTheMuse(query),
                this.fetchArbeitnow(query),
                this.fetchRemoteOK(query),
            ]);

            const apiResults = settled
                .filter(r => r.status === 'fulfilled')
                .map(r => (r as PromiseFulfilledResult<any[]>).value)
                .flat();

            // 2. Browser dorking with resilient selectors
            const dorkResults = await this.discoverViaUniversalDorks(query, page);

            const allJobs = [...apiResults, ...dorkResults];

            // 3. Deduplicate by URL
            const uniqueJobs = Array.from(new Map(allJobs.map(j => [j.url, j])).values());

            let saved = 0;
            for (const job of uniqueJobs) {
                const r = dbManager.saveJob(job);
                if (r?.changes > 0) saved++;
            }

            logger.info(`UNIVERSAL_ENGINE: ${allJobs.length} raw → ${uniqueJobs.length} unique → ${saved} new jobs saved.`);
        } catch (error: any) {
            logger.error('UniversalEngine discovery error:', error.message);
        }
    }

    private async discoverViaUniversalDorks(query: string, page: Page) {
        const dorkResults: any[] = [];
        const dorks = [
            `"${query}" "Apply Now" site:lever.co`,
            `"${query}" "Apply" site:greenhouse.io`,
            `"${query}" site:workable.com`,
            `"${query}" site:bamboohr.com`,
            `"${query}" "Careers" intitle:jobs -site:linkedin.com -site:indeed.com`,
        ];

        for (const dork of dorks) {
            try {
                const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(dork)}&t=h_&ia=web`;
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));

                // Try multiple selectors for resilience
                let links: { url: string; title: string }[] = [];
                for (const selector of this.DDG_SELECTORS) {
                    try {
                        links = await page.$$eval(selector, (els) =>
                            els.slice(0, 10).map(a => ({
                                url: (a as HTMLAnchorElement).href,
                                title: ((a as HTMLElement).innerText || (a as HTMLElement).textContent || '').trim()
                            }))
                        );
                        if (links.length > 0) break;
                    } catch { continue; }
                }

                for (const link of links) {
                    const isSpam = this.blacklist.some(site => link.url.toLowerCase().includes(site));
                    if (link.url && link.url.startsWith('http') && !isSpam && link.title) {
                        dorkResults.push({
                            id: `univ-${Buffer.from(link.url).toString('base64').substring(0, 16)}`,
                            title: link.title.substring(0, 120),
                            company: this.extractCompanyName(link.url),
                            url: link.url,
                            source: 'UniversalDork',
                            salary: 'N/A',
                            location: 'Remote',
                            postedDate: new Date().toISOString()
                        });
                    }
                }

                await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
            } catch (e: any) {
                logger.warn(`Dork fail: "${dork}" — ${e.message}`);
            }
        }
        return dorkResults;
    }

    private async fetchRemotive(query: string): Promise<any[]> {
        try {
            const { data } = await axios.get(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=20`, { timeout: 10000 });
            return (data.jobs || []).map((j: any) => ({
                id: `remotive-${j.id}`,
                title: j.title,
                company: j.company_name,
                url: j.url,
                source: 'Remotive',
                salary: j.salary || 'N/A',
                location: j.candidate_required_location || 'Remote',
                postedDate: j.publication_date
            }));
        } catch { return []; }
    }

    private async fetchTheMuse(query: string): Promise<any[]> {
        try {
            const { data } = await axios.get(`https://www.themuse.com/api/public/jobs?category=Software+Engineering&page=1`, { timeout: 10000 });
            return (data.results || []).map((j: any) => ({
                id: `themuse-${j.id}`,
                title: j.name,
                company: j.company.name,
                url: j.refs.landing_page,
                source: 'TheMuse',
                salary: 'N/A',
                location: j.locations?.[0]?.name || 'Remote',
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
            const jobs = Array.isArray(data) ? data.slice(1) : [];
            const qLower = query.toLowerCase();
            return jobs
                .filter((j: any) => `${j.position || ''} ${(j.tags || []).join(' ')}`.toLowerCase().includes(qLower))
                .slice(0, 15)
                .map((j: any) => ({
                    id: `remoteok-${j.id || j.slug}`,
                    title: j.position,
                    company: j.company,
                    url: j.url || `https://remoteok.com/l/${j.slug}`,
                    source: 'RemoteOK',
                    salary: j.salary_min ? `$${j.salary_min}` : 'N/A',
                    location: 'Remote Worldwide',
                    postedDate: j.date || new Date().toISOString()
                }));
        } catch { return []; }
    }

    private extractCompanyName(url: string): string {
        try {
            const urlObj = new URL(url);
            let slug = '';
            if (url.includes('lever.co') || url.includes('smartrecruiters.com')) {
                slug = urlObj.pathname.split('/')[1];
            } else {
                slug = urlObj.hostname.replace('www.', '').split('.')[0];
            }
            return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/[-_]/g, ' ');
        } catch { return 'Direct Company'; }
    }
}
