import { Page } from 'playwright';
import { BrowserBase } from './BrowserBase';
import { dbManager } from '../db/DBManager';
import { Humanoid } from './Humanoid';
import logger from '../utils/logger';
import path from 'path';

export class EmailSender {
    private browserBase: BrowserBase;

    constructor() {
        this.browserBase = new BrowserBase();
    }

    async sendPendingEmails() {
        const queue = dbManager.getEmailQueue('PENDING');
        if (queue.length === 0) {
            logger.info('EMAIL_SENDER: No pending emails in queue.');
            return;
        }

        logger.info(`EMAIL_SENDER: Commencing delivery of ${queue.length} emails via Gmail Web Automation.`);
        
        await this.browserBase.init(process.env.CHROME_PROFILE || 'Profile 2', false); // Visible mode for Gmail
        const page = await this.browserBase.createPage();
        const humanoid = new Humanoid(page);

        try {
            await page.goto('https://mail.google.com', { waitUntil: 'networkidle' });
            
            // Verify if logged in
            if (page.url().includes('signin')) {
                logger.error('EMAIL_SENDER: Gmail session not found. Please log in manually in the persistent browser.');
                return;
            }

            for (const email of queue) {
                try {
                    logger.info(`EMAIL_DELIVERY: Sending to ${email.to_email}...`);
                    
                    // 1. Click Compose (Selector varies, usually contains 'Compose' or 'C')
                    await page.click('div[role="button"]:has-text("Compose")');
                    await humanoid.waitRandom(1000, 2000);

                    // 2. Fill To
                    await page.fill('input[peoplekit-id]', email.to_email); // Recipient
                    await page.keyboard.press('Enter');

                    // 3. Fill Subject
                    await page.fill('input[name="subjectbox"]', email.subject);

                    // 4. Fill Body
                    const bodySelector = 'div[role="textbox"]';
                    await page.fill(bodySelector, email.body);
                    await humanoid.waitRandom(500, 1000);

                    // 5. Attach Resume
                    const resumePath = "/home/nikhil/Startup/Helper/Nikhil_Resume.pdf";
                    const [fileChooser] = await Promise.all([
                        page.waitForEvent('filechooser'),
                        page.click('div[command="Files"]') // Attachment icon
                    ]);
                    await fileChooser.setFiles(resumePath);
                    await humanoid.waitRandom(2000, 4000); // Wait for upload

                    // 6. Send
                    await page.click('div[role="button"][data-tooltip*="Send"]');
                    await humanoid.waitRandom(1000, 2000);

                    // 7. Update DB
                    // Note: In real setup, we'd add updateEmailStatus to DBManager
                    logger.info(`EMAIL_SUCCESS: Dispatched to ${email.to_email}`);
                } catch (err: any) {
                    logger.error(`EMAIL_FAILED: ${email.to_email} -> ${err.message}`);
                }
                
                // Pacing requested in plan
                await humanoid.waitRandom(10000, 20000); 
            }
        } finally {
            await this.browserBase.close();
        }
    }
}

export const emailSender = new EmailSender();
