import Database from 'better-sqlite3';
import logger from '../utils/logger';
import path from 'path';
import { EngineConfig } from '../utils/Config';

export class DBManager {
    private db: Database.Database;

    constructor() {
        const dbPath = process.env.DB_PATH || './horizon.db';
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');   // Better concurrent write performance
        this.db.pragma('foreign_keys = ON');
        this.init();
    }

    private init(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                title TEXT,
                company TEXT,
                url TEXT UNIQUE,
                source TEXT,
                salary TEXT,
                location TEXT,
                posted_date TEXT,
                description TEXT,
                discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT,
                status TEXT,  -- 'PENDING', 'APPLIED', 'FAILED', 'SKIPPED', 'IN_PROGRESS', 'EMAIL_QUEUED'
                applied_at DATETIME,
                next_retry_at DATETIME,
                match_score REAL,
                error_log TEXT,
                filled_data TEXT,
                screenshot_path TEXT,
                retry_count INTEGER DEFAULT 0,
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            );

            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS email_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT,
                to_email TEXT,
                subject TEXT,
                body TEXT,
                status TEXT, -- 'PENDING', 'SENT', 'FAILED'
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                sent_at DATETIME,
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            );

            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                company TEXT,
                email TEXT UNIQUE,
                linkedin_url TEXT,
                source TEXT,
                interaction_history TEXT,
                discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS manual_apply_list (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT,
                reason TEXT,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(job_id) REFERENCES jobs(id)
            );
        `);

        // Add retry_count column if it doesn't exist (migration safety)
        try {
            this.db.exec(`ALTER TABLE applications ADD COLUMN retry_count INTEGER DEFAULT 0`);
        } catch { /* column already exists */ }

        // Add description column to jobs if not exists
        try {
            this.db.exec(`ALTER TABLE jobs ADD COLUMN description TEXT`);
        } catch { /* already exists */ }
        try {
            this.db.exec(`ALTER TABLE applications ADD COLUMN next_retry_at DATETIME`);
        } catch { /* already exists */ }

        logger.info('DATABASE: Layer-0 Initialization Complete.');
    }

    public saveJob(job: any): any {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO jobs (id, title, company, url, source, salary, location, posted_date, description)
            VALUES (:id, :title, :company, :url, :source, :salary, :location, :postedDate, :description)
        `);
        return stmt.run({
            id: job.id,
            title: job.title ?? 'Unknown Title',
            company: job.company ?? 'Unknown Company',
            url: job.url,
            source: job.source ?? 'Universal',
            salary: job.salary ?? 'N/A',
            location: job.location ?? 'Remote',
            postedDate: job.postedDate ?? new Date().toISOString(),
            description: job.description ?? null
        });
    }

    public updateApplication(jobId: string, status: string, errorLog?: string, matchScore?: number, filledData?: any, screenshotPath?: string): any {
        const existing = this.db.prepare(`SELECT id, retry_count FROM applications WHERE job_id = ?`).get(jobId) as any;
        const retryMinutes = this.getRetryDelayMinutes(errorLog);

        if (existing) {
            const newRetryCount = status === 'FAILED' ? (existing.retry_count || 0) + 1 : (existing.retry_count || 0);
            const retryAt = (status === 'FAILED' || status === 'SKIPPED')
                ? `datetime('now', '+${retryMinutes} minutes')`
                : 'NULL';
            const stmt = this.db.prepare(`
                UPDATE applications 
                SET status = :status,
                    applied_at = CURRENT_TIMESTAMP,
                    next_retry_at = ${retryAt},
                    error_log = :errorLog,
                    match_score = :matchScore,
                    filled_data = :filledData,
                    screenshot_path = :screenshotPath,
                    retry_count = :retryCount
                WHERE job_id = :jobId
            `);
            return stmt.run({
                status,
                errorLog: errorLog ?? null,
                matchScore: matchScore ?? null,
                filledData: filledData ? JSON.stringify(filledData) : null,
                screenshotPath: screenshotPath ?? null,
                retryCount: newRetryCount,
                jobId
            });
        } else {
            const stmt = this.db.prepare(`
                INSERT INTO applications (job_id, status, applied_at, next_retry_at, error_log, match_score, filled_data, screenshot_path, retry_count)
                VALUES (:jobId, :status, CURRENT_TIMESTAMP, :nextRetryAt, :errorLog, :matchScore, :filledData, :screenshotPath, 0)
            `);
            const nextRetryAt = (status === 'FAILED' || status === 'SKIPPED')
                ? new Date(Date.now() + retryMinutes * 60000).toISOString()
                : null;
            return stmt.run({
                jobId,
                status,
                nextRetryAt,
                errorLog: errorLog ?? null,
                matchScore: matchScore ?? null,
                filledData: filledData ? JSON.stringify(filledData) : null,
                screenshotPath: screenshotPath ?? null
            });
        }
    }

    public claimJob(): any {
        const transaction = this.db.transaction(() => {
            const job = this.db.prepare(`
                SELECT j.* FROM jobs j
                LEFT JOIN (
                    SELECT a1.job_id, a1.status, a1.retry_count, a1.next_retry_at, a1.applied_at
                    FROM applications a1
                    INNER JOIN (
                        SELECT job_id, MAX(id) as max_id
                        FROM applications
                        GROUP BY job_id
                    ) latest ON latest.job_id = a1.job_id AND latest.max_id = a1.id
                ) last_app ON last_app.job_id = j.id
                WHERE last_app.status IS NULL
                   OR (
                        last_app.status NOT IN ('APPLIED', 'IN_PROGRESS', 'EMAIL_QUEUED')
                        AND COALESCE(last_app.retry_count, 0) < :maxRetries
                        AND (
                            last_app.next_retry_at IS NULL
                            OR datetime(last_app.next_retry_at) <= datetime('now')
                        )
                   )
                ORDER BY 
                    -- Prefer never-attempted jobs first, then oldest attempt.
                    CASE WHEN last_app.status IS NULL THEN 0 ELSE 1 END ASC,
                    COALESCE(last_app.applied_at, j.discovered_at) ASC,
                    j.discovered_at ASC
                LIMIT 1
            `).get({ maxRetries: EngineConfig.maxRetries }) as any;

            if (job) {
                const existing = this.db.prepare(`
                    SELECT id FROM applications WHERE job_id = :jobId ORDER BY id DESC LIMIT 1
                `).get({ jobId: job.id }) as any;

                if (existing) {
                    this.db.prepare(`
                        UPDATE applications
                        SET status = 'IN_PROGRESS', applied_at = CURRENT_TIMESTAMP
                        WHERE id = :id
                    `).run({ id: existing.id });
                } else {
                    this.db.prepare(`
                        INSERT INTO applications (job_id, status, applied_at)
                        VALUES (:jobId, 'IN_PROGRESS', CURRENT_TIMESTAMP)
                    `).run({ jobId: job.id });
                }
                return job;
            }
            return null;
        });
        return transaction();
    }

    /**
     * Resets jobs stuck IN_PROGRESS for more than the configured timeout.
     * Returns the count of reset jobs.
     */
    public resetStuckJobs(): number {
        const timeoutMinutes = EngineConfig.stuckJobTimeoutMinutes;
        const result = this.db.prepare(`
            UPDATE applications
            SET status = 'FAILED',
                error_log = 'Reset: Job was stuck IN_PROGRESS for over ${timeoutMinutes} minutes'
            WHERE status = 'IN_PROGRESS'
              AND applied_at < datetime('now', '-${timeoutMinutes} minutes')
        `).run();

        if (result.changes > 0) {
            logger.warn(`MAINTENANCE: Reset ${result.changes} stuck IN_PROGRESS jobs.`);
        }
        return result.changes;
    }

    /**
     * Returns failed jobs eligible for retry (retry_count < maxRetries).
     */
    public getFailedJobsForRetry(): any[] {
        const maxRetries = EngineConfig.maxRetries;
        return this.db.prepare(`
            SELECT j.*, a.retry_count FROM jobs j
            INNER JOIN applications a ON j.id = a.job_id
            WHERE a.status = 'FAILED'
              AND (a.retry_count IS NULL OR a.retry_count < :maxRetries)
              AND (a.next_retry_at IS NULL OR datetime(a.next_retry_at) <= datetime('now'))
            ORDER BY a.applied_at ASC
            LIMIT 5
        `).all({ maxRetries }) as any[];
    }

    /**
     * Re-opens a failed job for retry by setting it back to IN_PROGRESS.
     */
    public requeueFailedJob(jobId: string): void {
        this.db.prepare(`
            UPDATE applications SET status = 'IN_PROGRESS', applied_at = CURRENT_TIMESTAMP, next_retry_at = NULL
            WHERE job_id = :jobId AND status = 'FAILED'
        `).run({ jobId });
        logger.info(`RECOVERY: Re-queued failed job ${jobId} for retry.`);
    }

    public hasPendingWork(): boolean {
        const row = this.db.prepare(`
            SELECT 1 as ok
            FROM jobs j
            LEFT JOIN (
                SELECT a1.job_id, a1.status, a1.retry_count, a1.next_retry_at
                FROM applications a1
                INNER JOIN (
                    SELECT job_id, MAX(id) as max_id
                    FROM applications
                    GROUP BY job_id
                ) latest ON latest.job_id = a1.job_id AND latest.max_id = a1.id
            ) last_app ON last_app.job_id = j.id
            WHERE last_app.status IS NULL
               OR (
                    last_app.status NOT IN ('APPLIED', 'IN_PROGRESS', 'EMAIL_QUEUED')
                    AND COALESCE(last_app.retry_count, 0) < :maxRetries
                    AND (
                        last_app.next_retry_at IS NULL
                        OR datetime(last_app.next_retry_at) <= datetime('now')
                    )
               )
            LIMIT 1
        `).get({ maxRetries: EngineConfig.maxRetries }) as any;
        return !!row;
    }

    private getRetryDelayMinutes(errorLog?: string): number {
        const msg = String(errorLog || '').toUpperCase();
        if (msg.includes('CAPTCHA_BLOCK')) return 360; // 6h
        if (msg.includes('AUTH_REQUIRED')) return 120; // 2h
        if (msg.includes('BROWSER_FLOW_ERROR')) return 45;
        if (msg.includes('VALIDATION_ERROR')) return 30;
        if (msg.includes('NO_FORM_FOUND')) return 90;
        return EngineConfig.retryCooldownMinutes;
    }

    public getPendingJobs(): any[] {
        return this.db.prepare(`
            SELECT * FROM jobs
            WHERE id NOT IN (SELECT job_id FROM applications WHERE status IN ('APPLIED', 'IN_PROGRESS', 'EMAIL_QUEUED'))
            ORDER BY discovered_at ASC
        `).all();
    }

    public getRecentJobs(limit: number = 25): any[] {
        return this.db.prepare(`
            SELECT j.id, j.title, j.company, j.url, j.source, j.location, j.salary, j.discovered_at,
                   a.status, a.match_score, a.filled_data, a.screenshot_path, a.error_log, a.retry_count
            FROM jobs j
            LEFT JOIN applications a ON j.id = a.job_id
            ORDER BY j.discovered_at DESC
            LIMIT :limit
        `).all({ limit });
    }

    public getStats(): any {
        try {
            const totalJobs    = (this.db.prepare(`SELECT COUNT(*) as c FROM jobs`).get() as any).c;
            const applied      = (this.db.prepare(`SELECT COUNT(*) as c FROM applications WHERE status = 'APPLIED'`).get() as any).c;
            const failed       = (this.db.prepare(`SELECT COUNT(*) as c FROM applications WHERE status = 'FAILED'`).get() as any).c;
            const inProgress   = (this.db.prepare(`SELECT COUNT(*) as c FROM applications WHERE status = 'IN_PROGRESS'`).get() as any).c;
            const skipped      = (this.db.prepare(`SELECT COUNT(*) as c FROM applications WHERE status = 'SKIPPED'`).get() as any).c;
            const emailQueued  = (this.db.prepare(`SELECT COUNT(*) as c FROM applications WHERE status = 'EMAIL_QUEUED'`).get() as any).c;
            const totalAttempts = (this.db.prepare(`SELECT COUNT(*) as c FROM applications WHERE status != 'IN_PROGRESS'`).get() as any).c;
            const pending = (this.db.prepare(`
                SELECT COUNT(*) as c FROM jobs
                WHERE id NOT IN (SELECT job_id FROM applications WHERE status IN ('APPLIED','SKIPPED','IN_PROGRESS','FAILED','EMAIL_QUEUED'))
            `).get() as any).c;
            const contacts    = (this.db.prepare(`SELECT COUNT(*) as c FROM contacts`).get() as any).c;
            const emailPending = (this.db.prepare(`SELECT COUNT(*) as c FROM email_queue WHERE status = 'PENDING'`).get() as any).c;

            return { totalJobs, applied, failed, inProgress, skipped, emailQueued, totalAttempts, pending, contacts, emailPending };
        } catch (e) {
            logger.error('DB_STATS_FAILURE:', e);
            return { totalJobs: 0, applied: 0, failed: 0, inProgress: 0, skipped: 0, emailQueued: 0, totalAttempts: 0, pending: 0, contacts: 0, emailPending: 0 };
        }
    }

    public saveContact(contact: any): any {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO contacts (name, company, email, linkedin_url, source, interaction_history)
            VALUES (:name, :company, :email, :linkedin_url, :source, :interactionHistory)
        `);
        return stmt.run({
            name: contact.name ?? 'Unknown',
            company: contact.company ?? 'Unknown',
            email: contact.email,
            linkedin_url: contact.linkedin_url ?? null,
            source: contact.source ?? 'Discovery',
            interactionHistory: JSON.stringify([{ date: new Date().toISOString(), type: 'DISCOVERED' }])
        });
    }

    public updateContact(contactId: number, interactionHistory: string): void {
        this.db.prepare(`
            UPDATE contacts SET interaction_history = :interactionHistory WHERE id = :id
        `).run({ interactionHistory, id: contactId });
    }

    public queueEmail(email: any): any {
        const stmt = this.db.prepare(`
            INSERT INTO email_queue (job_id, to_email, subject, body, status)
            VALUES (:jobId, :toEmail, :subject, :body, 'PENDING')
        `);
        return stmt.run({
            jobId: email.jobId,
            toEmail: email.toEmail,
            subject: email.subject,
            body: email.body
        });
    }

    public getEmailQueue(status: string = 'PENDING'): any[] {
        return this.db.prepare(`SELECT * FROM email_queue WHERE status = :status ORDER BY created_at ASC`).all({ status });
    }

    public getContacts(): any[] {
        return this.db.prepare(`SELECT * FROM contacts ORDER BY discovered_at DESC`).all();
    }

    public saveToManualList(jobId: string, reason: string): any {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO manual_apply_list (job_id, reason)
            VALUES (:jobId, :reason)
        `);
        return stmt.run({ jobId, reason });
    }

    public getManualList(): any[] {
        return this.db.prepare(`
            SELECT m.*, j.title, j.company, j.url
            FROM manual_apply_list m
            JOIN jobs j ON m.job_id = j.id
            ORDER BY m.added_at DESC
        `).all();
    }
}

export const dbManager = new DBManager();
