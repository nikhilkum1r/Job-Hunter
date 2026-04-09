import { RichProfile } from './DataMapper';
import logger from '../utils/logger';
import { dbManager } from '../db/DBManager';

export class EmailEngine {
    async generateApplicationEmail(job: any, profile: RichProfile): Promise<any> {
        try {
            logger.info(`EMAIL_ENGINE: Drafting application for "${job.title}" at ${job.company}`);
            const draft = this.getGenericEmail(job, profile);

            dbManager.queueEmail({
                jobId: job.id,
                toEmail: job.hrEmail || 'careers@' + this.extractDomain(job.url),
                subject: draft.subject,
                body: draft.body
            });

            logger.info(`EMAIL_ENGINE: Queued email to ${job.hrEmail || 'careers@' + this.extractDomain(job.url)}`);
            return draft;
        } catch (error: any) {
            logger.error('Email generation failed:', error.message);
            // Return a safe fallback
            const fallback = this.getGenericEmail(job, profile);
            try {
                dbManager.queueEmail({
                    jobId: job.id,
                    toEmail: job.hrEmail || 'careers@' + this.extractDomain(job.url),
                    subject: fallback.subject,
                    body: fallback.body
                });
            } catch { }
            return fallback;
        }
    }

    async generateFollowUp(application: any, profile: RichProfile): Promise<any> {
        return {
            subject: `Follow-up: ${application.jobTitle || application.title} Application`,
            body: `Dear Hiring Manager,\n\nI wanted to follow up on my application for the ${application.jobTitle || application.title} role submitted recently. I remain very interested and would welcome the opportunity to discuss further.\n\nBest regards,\n${profile.personal_information.full_name}\n${profile.contact_information.phone_primary}`
        };
    }

    private getGenericEmail(job: any, profile: RichProfile): { subject: string; body: string } {
        const name = profile.personal_information.full_name;
        const topSkill = profile.ats_keywords?.[0] || 'software engineering';
        return {
            subject: `Application for ${job.title} – ${name}`,
            body: `Dear Hiring Manager,\n\nI am writing to express my strong interest in the ${job.title} position at ${job.company}. With hands-on experience in ${topSkill} and a strong project portfolio, I am confident I can add immediate value to your team.\n\nI would welcome the opportunity to discuss how my background aligns with your needs.\n\nBest regards,\n${name}\n${profile.contact_information.phone_primary} | ${profile.contact_information.email}\n${profile.online_profiles.linkedin}`
        };
    }

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch {
            return 'company.com';
        }
    }
}

export const emailEngine = new EmailEngine();
