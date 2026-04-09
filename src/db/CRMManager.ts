import { dbManager } from './DBManager';
import logger from '../utils/logger';

export class CRMManager {
    private readonly PRIORITY_DOMAINS = ['spacex.com', 'openai.com', 'google.com', 'microsoft.com', 'apple.com', 'meta.com', 'netflix.com', 'stripe.com'];

    public async getPriorityCompanies(): Promise<any[]> {
        const contacts = dbManager.getContacts();
        return contacts.filter(c =>
            this.PRIORITY_DOMAINS.some(d => c.email.toLowerCase().includes(d)) ||
            c.source?.toLowerCase().includes('gold')
        );
    }

    public async recordInteraction(contactId: number, type: string, note: string) {
        const contacts = dbManager.getContacts();
        const contact = contacts.find((c: any) => c.id === contactId);
        if (!contact) {
            logger.warn(`CRM: Contact ID ${contactId} not found.`);
            return;
        }

        let history: any[] = [];
        try {
            history = JSON.parse(contact.interaction_history || '[]');
        } catch { history = []; }

        history.push({
            date: new Date().toISOString(),
            type,
            note
        });

        dbManager.updateContact(contactId, JSON.stringify(history));
        logger.info(`CRM_UPDATE: Recorded [${type}] interaction for ${contact.email}`);
    }

    public async getAppliedContacts(): Promise<any[]> {
        const contacts = dbManager.getContacts();
        // Filter contacts whose email domain matches companies we've applied to
        const jobs = dbManager.getRecentJobs(100);
        const appliedDomains = new Set<string>();

        for (const job of jobs) {
            if (job.status === 'APPLIED' || job.status === 'EMAIL_QUEUED') {
                try {
                    const domain = new URL(job.url).hostname.replace('www.', '');
                    appliedDomains.add(domain);
                } catch { }
            }
        }

        return contacts.filter((c: any) => {
            const domain = c.email.split('@')[1];
            return appliedDomains.has(domain);
        });
    }

    public async getContactsByCompany(company: string): Promise<any[]> {
        const contacts = dbManager.getContacts();
        const companyLower = company.toLowerCase();
        return contacts.filter((c: any) =>
            (c.email || '').toLowerCase().includes(companyLower) ||
            (c.company || '').toLowerCase().includes(companyLower) ||
            (c.source || '').toLowerCase().includes(companyLower)
        );
    }

    public async getStats(): Promise<{ total: number; priority: number; interacted: number }> {
        const contacts = dbManager.getContacts();
        const priority = await this.getPriorityCompanies();
        const interacted = contacts.filter((c: any) => {
            try {
                const h = JSON.parse(c.interaction_history || '[]');
                return h.length > 1; // More than initial discovery
            } catch { return false; }
        });
        return { total: contacts.length, priority: priority.length, interacted: interacted.length };
    }
}

export const crmManager = new CRMManager();
