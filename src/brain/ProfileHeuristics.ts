import logger from '../utils/logger';
import { RichProfile } from './DataMapper';

export class ProfileHeuristics {
    
    private techDictionary = [
        'react', 'node', 'typescript', 'javascript', 'python', 'java', 'go', 'golang', 
        'aws', 'docker', 'kubernetes', 'sql', 'nosql', 'mongodb', 'postgresql', 
        'frontend', 'backend', 'fullstack', 'mobile', 'ios', 'android', 'flutter', 
        'devops', 'security', 'machine learning', 'ai', 'data engineer', 'cloud'
    ];

    private rolePatterns = [
        { name: 'Frontend Engineer', patterns: [/frontend/i, /react/i, /vue/i, /design/i] },
        { name: 'Backend Engineer', patterns: [/backend/i, /node/i, /python/i, /database/i, /api/i] },
        { name: 'Full Stack Engineer', patterns: [/full[ -]?stack/i, /universal/i] },
        { name: 'Software Engineer', patterns: [/software engineer/i, /software developer/i] },
        { name: 'DevOps Engineer', patterns: [/devops/i, /infra/i, /cloud/i, /aws/i] }
    ];

    generateSearchQueries(profile: RichProfile): string[] {
        logger.info('HEURISTICS: Generating randomized search rotation...');
        const bio = (profile.profile_variants?.backend || '').toLowerCase();
        
        // 1. Extract Skills
        const skillsFound = this.techDictionary.filter(skill => bio.includes(skill));
        
        // 2. Extract Primary Role
        let primaryRole = 'Software Engineer';
        for (const role of this.rolePatterns) {
            if (role.patterns.some(p => p.test(bio))) {
                primaryRole = role.name;
                break;
            }
        }

        // 3. SHUFFLING LOGIC (The Anti-Stuck Upgrade)
        // We pick different combinations on each call
        const shuffledSkills = skillsFound.sort(() => Math.random() - 0.5);
        const queries: string[] = [];

        // Randomly combine top skills with role
        if (shuffledSkills.length >= 2) {
            queries.push(`${primaryRole} ${shuffledSkills[0]} ${shuffledSkills[1]}`);
        }

        // Add a random variation of the role
        const roleVariations = [primaryRole, `${shuffledSkills[0] || ''} Developer`, `Remote ${primaryRole}`];
        queries.push(roleVariations[Math.floor(Math.random() * roleVariations.length)]);

        // Specialized skill search
        if (shuffledSkills.length > 2) {
            queries.push(`${shuffledSkills[Math.floor(Math.random() * shuffledSkills.length)]} ${primaryRole}`);
        }

        const finalQueries = Array.from(new Set(queries.filter(q => q.trim().length > 0))).slice(0, 3);
        logger.info(`HEURISTICS: Search Rotation for this cycle: [${finalQueries.join(' | ')}]`);

        return finalQueries;
    }
}
