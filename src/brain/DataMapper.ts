export interface RichProfile {
    personal_information: {
        first_name: string;
        last_name: string;
        full_name: string;
        gender: string;
        date_of_birth: string;
        nationality: string;
        marital_status: string;
        aadhaar_number?: string;
        pan_number?: string;
    };
    contact_information: {
        email: string;
        phone_primary: string;
        phone_secondary?: string;
        current_location: string;
        willing_to_relocate: boolean;
        address?: any;
    };
    online_profiles: {
        linkedin: string;
        github: string;
        portfolio?: string;
        leetcode?: string;
        hackerrank?: string;
        twitter?: string;
    };
    form_ready_fields?: any;
    ats_keywords?: string[];
    profile_variants?: { [key: string]: string };
    cover_letter_templates?: { [key: string]: string };
    proof_of_work?: any;
    availability?: any;
    risk_flags?: any;
    answer_snippets?: any;
    recovery_strategy?: any;
    education: any[];
    work_experience: any[];
    projects: any[];
    skills: any;
    certifications: any[];
    achievements: string[];
    languages: any[];
    job_preferences: any;
    salary_details?: any;
    screening_answers?: any;
    resumePath: string;
}

export class DataMapper {
    private profile: RichProfile;

    constructor(profile: RichProfile) {
        this.profile = profile;
    }

    public getBestRoleVariant(jobTitle: string): string {
        const title = jobTitle.toLowerCase();
        const variants = this.profile.profile_variants || {};

        if (title.includes('machine') || title.includes('ml') || title.includes('ai') || title.includes('intelligence')) {
            return variants.ml_engineer || variants.backend || '';
        }
        if (title.includes('security') || title.includes('cyber') || title.includes('penetration') || title.includes('ethical')) {
            return variants.cybersecurity || variants.backend || '';
        }
        if (title.includes('frontend') || title.includes('front-end') || title.includes('react') || title.includes('vue')) {
            return variants.frontend || variants.backend || '';
        }
        if (title.includes('devops') || title.includes('cloud') || title.includes('infra')) {
            return variants.devops || variants.backend || '';
        }
        return variants.backend || Object.values(variants)[0] || '';
    }

    public getStrategicTemplate(jobTitle: string, type: 'cover_letter' | 'summary'): string {
        const title = jobTitle.toLowerCase();
        if (type === 'cover_letter') {
            const templates = this.profile.cover_letter_templates || {};
            if (title.includes('ml') || title.includes('ai') || title.includes('machine')) return templates.ml_role || templates.default || '';
            if (title.includes('security') || title.includes('cyber')) return templates.cybersecurity_role || templates.default || '';
            if (title.includes('frontend') || title.includes('react')) return templates.frontend_role || templates.default || '';
            return templates.default || '';
        }
        return this.getBestRoleVariant(jobTitle);
    }

    /**
     * Maps form field labels to the correct profile data.
     * Covers 40+ common field patterns across all major ATS portals.
     */
    mapFieldToData(fieldLabel: string, fieldType: string): string {
        const label = fieldLabel.toLowerCase().trim();
        const p = this.profile.personal_information;
        const c = this.profile.contact_information;
        const o = this.profile.online_profiles;
        const f = this.profile.form_ready_fields || {};
        const sa = this.profile.screening_answers || {};
        const edu = this.profile.education?.[0] || {};
        const exp = this.profile.work_experience?.[0] || {};
        const sal = this.profile.salary_details || {};
        const avail = this.profile.availability || {};

        // === PERSONAL ===
        if (/^first\s?name$|^given\s?name$|^fname$/.test(label)) return f.first_name || p.first_name;
        if (/^last\s?name$|^family\s?name$|^surname$|^lname$/.test(label)) return f.last_name || p.last_name;
        if (/full\s?name|^name$|your name/.test(label)) return f.full_name || p.full_name;
        if (/gender|sex/.test(label)) return p.gender || 'Male';
        if (/date of birth|dob|birth date/.test(label)) return p.date_of_birth || '';
        if (/nationality|citizenship/.test(label)) return p.nationality || 'Indian';

        // === CONTACT ===
        if (/email|e-mail/.test(label)) return f.email || c.email;
        if (/phone|telephone|mobile|contact number/.test(label)) return f.phone_number || c.phone_primary;
        if (/alternate.*phone|secondary.*phone/.test(label)) return c.phone_secondary || c.phone_primary;
        if (/city/.test(label)) return f.city || c.address?.city || 'New Delhi';
        if (/state|province/.test(label)) return f.state || c.address?.state || 'Delhi';
        if (/country/.test(label)) return f.country || c.address?.country || 'India';
        if (/zip|postal|pin\s?code/.test(label)) return f.zip_code || c.address?.pincode || '110001';
        if (/address|street/.test(label)) return f.address || `${c.address?.street || ''}, ${c.address?.city || 'New Delhi'}, India`.trim();
        if (/location|current location|where.*located/.test(label)) return c.current_location || 'New Delhi, India';
        if (/willing.*relocat|open.*relocat/.test(label)) return c.willing_to_relocate ? 'Yes' : 'No';

        // === ONLINE PROFILES ===
        if (/linkedin/.test(label)) return f.linkedin || o.linkedin;
        if (/github|git hub/.test(label)) return f.github || o.github;
        if (/portfolio|personal.*site|website/.test(label)) return o.portfolio || o.github;
        if (/leetcode/.test(label)) return o.leetcode || '';
        if (/hackerrank/.test(label)) return o.hackerrank || '';
        if (/twitter|x\.com/.test(label)) return o.twitter || '';

        // === WORK EXPERIENCE ===
        if (/current.*company|employer|organization/.test(label)) return f.current_company || exp.company || '';
        if (/current.*title|current.*role|current.*position/.test(label)) return exp.title || f.current_title || '';
        if (/total.*experience|years.*experience|experience.*years|how many years/.test(label)) {
            return sal.total_experience || f.years_of_experience || '2';
        }
        if (/notice period|notice.*required|when.*start|availability|available.*join/.test(label)) {
            return avail.notice_period || f.notice_period || 'Immediately';
        }

        // === EDUCATION ===
        if (/college|university|institution|school name/.test(label)) return edu.institution || '';
        if (/degree|qualification/.test(label)) return edu.degree || 'B.Tech';
        if (/major|field of study|specialization/.test(label)) return edu.major || edu.field_of_study || 'Computer Science';
        if (/graduation year|year of graduation|pass out/.test(label)) return edu.graduation_year?.toString() || '';
        if (/gpa|cgpa|percentage|marks/.test(label)) return edu.cgpa?.toString() || '';

        // === SALARY ===
        if (/expected.*salary|desired.*salary|salary.*expect/.test(label)) return sal.expected_salary || '';
        if (/current.*salary|last.*salary|present.*salary/.test(label)) return sal.current_salary || '';

        // === WORK AUTHORIZATION ===
        if (/work.*authoriz|right.*work|visa.*status|visa.*sponsor|require.*sponsor/.test(label)) {
            return sa.work_authorization || 'No';
        }
        if (/currently.*employ|are you.*employ/.test(label)) return exp.company ? 'Yes' : 'No';
        if (/us citizen|citizen.*us/.test(label)) return 'No';

        // === COMMON SCREENING ===
        if (/how.*hear|source.*application|refer/.test(label)) return sa.how_did_you_hear || 'LinkedIn';
        if (/cover.*letter/.test(label)) return ''; // Handled separately
        if (/message|why.*interested|why.*apply|why.*company/.test(label)) {
            return sa.why_interested || this.getStrategicTemplate('software engineer', 'summary');
        }
        if (/disability|disabled/.test(label)) return sa.disability || 'No';
        if (/veteran|military/.test(label)) return sa.veteran_status || 'No';
        if (/ethnicity|race/.test(label)) return sa.ethnicity || 'Prefer not to say';

        return '';
    }

    getResumePath(): string {
        return this.profile.resumePath;
    }

    getRawProfile(): RichProfile {
        return this.profile;
    }
}
