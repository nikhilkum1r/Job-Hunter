import * as dotenv from 'dotenv';
dotenv.config();  // Single config call

import { Orchestrator } from './controller/Orchestrator';
import { EngineConfig } from './utils/Config';
import logger from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function run() {
    try {
        // Parse CLI args for query and protocol
        const args = process.argv.slice(2);
        const queryArg = args.find(a => a.startsWith('--query='))?.replace('--query=', '');
        const protocolArg = args.find(a => a.startsWith('--protocol='))?.replace('--protocol=', '') as any;
        const sourceArg = args.find(a => a.startsWith('--source='))?.replace('--source=', '');

        if (protocolArg && ['STEALTH', 'BALANCED', 'TURBO'].includes(protocolArg)) {
            EngineConfig.setProtocol(protocolArg);
        }

        const profilePath = path.join(process.cwd(), 'nikhil.json');
        if (!fs.existsSync(profilePath)) {
            throw new Error(`Profile not found at: ${profilePath}. Please create nikhil.json.`);
        }

        const raw = fs.readFileSync(profilePath, 'utf8');
        const profile = JSON.parse(raw);
        profile.resumePath = profile.resumePath || path.join(process.cwd(), 'Nikhil_Resume.pdf');

        // Ensure screenshots directory exists
        const screenshotsDir = path.join(process.cwd(), 'screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        const query = queryArg || profile.job_preferences?.roles?.[0] || 'Remote Software Engineer';
        const source = normalizeSource(sourceArg || 'ALL');

        logger.info(`=== HORIZON: Starting with query="${query}", source=${source}, protocol=${EngineConfig.protocol} ===`);

        const orchestrator = new Orchestrator(profile);

        // Graceful shutdown
        process.on('SIGINT', () => {
            logger.info('SIGINT received. Shutting down gracefully...');
            orchestrator.stop();
            setTimeout(() => process.exit(0), 3000);
        });
        process.on('SIGTERM', () => {
            orchestrator.stop();
            setTimeout(() => process.exit(0), 3000);
        });

        await orchestrator.start(query, source);
    } catch (error: any) {
        logger.error('Main orchestrator failed:', error.message);
        process.exit(1);
    }
}

run();

function normalizeSource(source: string): string {
    const s = (source || 'ALL').trim().toUpperCase();
    const aliases: Record<string, string> = {
        LINKDEN: 'LINKEDIN',
        LINKDIN: 'LINKEDIN',
        LINKEDIN: 'LINKEDIN',
        INDEED: 'INDEED',
        NAUKRI: 'NAUKRI',
        WELLFOUND: 'WELLFOUND',
        INTERNSHALA: 'INTERNSHALA',
        DIRECT: 'DIRECT',
        API: 'API',
        ALL: 'ALL',
        RANDOM: 'RANDOM'
    };
    return aliases[s] || 'ALL';
}
