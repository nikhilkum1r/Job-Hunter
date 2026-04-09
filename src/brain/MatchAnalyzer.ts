import { RichProfile } from './DataMapper';
import logger from '../utils/logger';

export class MatchAnalyzer {
    async analyzeMatch(jobDescription: string, profile: RichProfile): Promise<{ score: number; reason: string }> {
        // TIER 1: STRATEGIC KEYWORD MATCH (ATS Bank)
        const heuristic = this.heuristicMatch(jobDescription, profile);
        
        // Default deterministic matching for reliability and zero API dependence.
        if (process.env.ENABLE_AI !== 'true') {
            logger.info(`MATCHING: Deterministic mode enabled. Using heuristic score ${heuristic.score}%.`);
            return heuristic;
        }

        return heuristic;
    }

    private heuristicMatch(jobDescription: string, profile: RichProfile): { score: number; reason: string } {
        const jd = jobDescription.toLowerCase();
        
        // Collate ALL known skills into a unified strategy bank
        const strategyBank = [
            ...(profile.ats_keywords || []),
            ...(profile.skills?.programming_languages || []),
            ...(profile.skills?.ml_ai || []),
            ...(profile.skills?.backend || []),
            ...(profile.skills?.cybersecurity || [])
        ];
        
        // De-duplicate and filter noise
        const uniqueTags = [...new Set(strategyBank)]
            .filter(t => t && t.trim().length > 1);
        
        const matches = uniqueTags.filter(tag => jd.includes(tag.toLowerCase()));
        
        // Base score: 30 points floor if any match, then 10 points per tag, capped at 100.
        // Higher weights for core tech alignment ensures fewer false-negative skips.
        const score = matches.length > 0 
            ? Math.min(30 + (matches.length * 10), 100) 
            : 0;
        
        return { 
            score, 
            reason: `Heuristic: Identified ${matches.length} strategic skill intersections (${matches.slice(0, 5).join(', ')}...)` 
        };
    }

}
