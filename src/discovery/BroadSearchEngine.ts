import { Page } from 'playwright';
import axios from 'axios';
import logger from '../utils/logger';
import { dbManager } from '../db/DBManager';

export class BroadSearchEngine {
    private page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    async search(query: string) {
        logger.info(`Starting PRO-LEVEL discovery using Remotive Job API for: ${query}`);
        
        try {
            // Using Remotive API for 100% reliable discovery without CAPTCHAs
            const searchUrl = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`;
            const response = await axios.get(searchUrl);
            
            // Limit to top 50 in this sweep to keep DB fresh
            const results = (response.data.jobs || []).slice(0, 50);

            for (const result of results) {
                // Ensure unique ID
                const jobId = result.id ? result.id.toString() : Buffer.from(result.url).toString('base64').substring(0, 20);
                dbManager.saveJob({
                    id: jobId,
                    title: result.title,
                    company: result.company_name,
                    url: result.url,
                    source: 'Remotive API',
                    salary: result.salary || 'N/A',
                    location: result.candidate_required_location || 'Remote/Unknown',
                    postedDate: result.publication_date || new Date().toISOString()
                });
            }

            logger.info(`Discovered ${results.length} prospective job URLs via Pro API Search.`);
        } catch (error: any) {
            logger.error('Broad search failure:', error.message || error);
        }
    }
}
