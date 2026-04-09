import React, { useState } from 'react';
import { 
  User, Mail, Briefcase, GraduationCap, Code, 
  Award, Globe, Save, X, Trash2, Plus, Zap,
  ChevronRight, Laptop, Shield, DollarSign, Info
} from 'lucide-react';
import axios from 'axios';

const ProfileEditor = ({ profile, onSave, onClose }) => {
  const [editedProfile, setEditedProfile] = useState(profile);
  const [activeTab, setActiveTab] = useState('identity');

  const tabs = [
    { id: 'identity', label: 'Identity', icon: User },
    { id: 'backstory', label: 'Work & Edu', icon: Briefcase },
    { id: 'arsenal', label: 'Skills & Certs', icon: Code },
    { id: 'strategy', label: 'Playbook', icon: Zap },
    { id: 'answers', label: 'Screening', icon: Info },
    { id: 'preferences', label: 'Preferences', icon: Shield }
  ];

  const handleUpdate = (path, value) => {
    const newData = { ...editedProfile };
    const parts = path.split('.');
    let current = newData;
    for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    setEditedProfile(newData);
  };

  const saveProfile = async () => {
    try {
        await axios.post('/api/profile', editedProfile);
        onSave(editedProfile);
    } catch (err) {
        alert('Failed to save profile');
    }
  };

  return (
    <div className="profile-editor-modal glass-panel">
      <div className="pe-header">
        <div className="pe-title">
          <User size={20} className="neon-text" />
          <h2>PROFESSIONAL IDENTITY REGISTRY</h2>
        </div>
        <div className="pe-actions">
           <button className="btn-save" onClick={saveProfile}>
             <Save size={16} /> SAVE CHANGES
           </button>
           <button className="btn-close" onClick={onClose}>
             <X size={20} />
           </button>
        </div>
      </div>

      <div className="pe-layout">
        <aside className="pe-sidebar">
          {tabs.map(tab => (
            <button 
                key={tab.id}
                className={`pe-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={18} />
              <span>{tab.label}</span>
              <ChevronRight size={14} className="pe-chevron" />
            </button>
          ))}
        </aside>

        <div className="pe-content">
          {activeTab === 'identity' && (
            <div className="pe-form-section">
              <h3>Personal Information</h3>
              <div className="pe-inline-group">
                <div className="pe-input">
                  <label>First Name</label>
                  <input value={editedProfile?.personal_information?.first_name || ""} onChange={e => handleUpdate('personal_information.first_name', e.target.value)} />
                </div>
                <div className="pe-input">
                  <label>Last Name</label>
                  <input value={editedProfile?.personal_information?.last_name || ""} onChange={e => handleUpdate('personal_information.last_name', e.target.value)} />
                </div>
              </div>
              <div className="pe-input">
                <label>Full Name</label>
                <input value={editedProfile?.personal_information?.full_name || ""} onChange={e => handleUpdate('personal_information.full_name', e.target.value)} />
              </div>
              
              <h3>Contact Information</h3>
              <div className="pe-input">
                <label>Email Address</label>
                <input value={editedProfile?.contact_information?.email || ""} onChange={e => handleUpdate('contact_information.email', e.target.value)} />
              </div>
              <div className="pe-inline-group">
                <div className="pe-input">
                  <label>Primary Phone</label>
                  <input value={editedProfile?.contact_information?.phone_primary || ""} onChange={e => handleUpdate('contact_information.phone_primary', e.target.value)} />
                </div>
                <div className="pe-input">
                  <label>Location</label>
                  <input value={editedProfile?.contact_information?.current_location || ""} onChange={e => handleUpdate('contact_information.current_location', e.target.value)} />
                </div>
              </div>

              <h3>Online Profiles</h3>
              <div className="pe-input">
                <label>LinkedIn URL</label>
                <input value={editedProfile?.online_profiles?.linkedin || ""} onChange={e => handleUpdate('online_profiles.linkedin', e.target.value)} />
              </div>
              <div className="pe-input">
                <label>GitHub URL</label>
                <input value={editedProfile?.online_profiles?.github || ""} onChange={e => handleUpdate('online_profiles.github', e.target.value)} />
              </div>
            </div>
          )}

          {activeTab === 'backstory' && (
            <div className="pe-form-section">
              <h3>Work Experience</h3>
              {(editedProfile?.work_experience || []).map((exp, idx) => (
                <div key={idx} className="pe-nested-card">
                  <div className="pe-inline-group">
                    <div className="pe-input"><label>Company</label><input value={exp.company} onChange={e => {
                        const newExp = [...editedProfile?.work_experience];
                        newExp[idx].company = e.target.value;
                        handleUpdate('work_experience', newExp);
                    }} /></div>
                    <div className="pe-input"><label>Role</label><input value={exp.role} onChange={e => {
                        const newExp = [...editedProfile?.work_experience];
                        newExp[idx].role = e.target.value;
                        handleUpdate('work_experience', newExp);
                    }} /></div>
                  </div>
                  <div className="pe-input"><label>Duration</label><input value={`${exp.start_date} - ${exp.end_date}`} disabled /></div>
                </div>
              ))}

              <h3>Education</h3>
              {(editedProfile?.education || []).map((edu, idx) => (
                <div key={idx} className="pe-nested-card">
                  <div className="pe-input"><label>Institution</label><input value={edu.institution} /></div>
                  <div className="pe-input"><label>Degree</label><input value={edu.degree} /></div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'arsenal' && (
            <div className="pe-form-section">
              <h3>Categorized Skills</h3>
              <div className="pe-input">
                <label>Programming Languages</label>
                <input value={(editedProfile.skills?.programming_languages || []).join(', ')} onChange={e => handleUpdate('skills.programming_languages', e.target.value.split(',').map(s => s.trim()))} />
              </div>
              <div className="pe-input">
                <label>ML & AI Stack</label>
                <input value={(editedProfile.skills?.ml_ai || []).join(', ')} onChange={e => handleUpdate('skills.ml_ai', e.target.value.split(',').map(s => s.trim()))} />
              </div>
              <div className="pe-input">
                <label>Backend & DevOps</label>
                <input value={(editedProfile.skills?.backend || []).join(', ')} onChange={e => handleUpdate('skills.backend', e.target.value.split(',').map(s => s.trim()))} />
              </div>
              <div className="pe-input">
                <label>Cybersecurity Expertise</label>
                <input value={(editedProfile.skills?.cybersecurity || []).join(', ')} onChange={e => handleUpdate('skills.cybersecurity', e.target.value.split(',').map(s => s.trim()))} />
              </div>

              <h3>Featured Projects</h3>
              {(editedProfile?.projects || []).map((proj, idx) => (
                <div key={idx} className="pe-nested-card">
                   <div className="pe-input"><label>Project Name</label><input value={proj.name} onChange={e => {
                        const newProj = [...editedProfile?.projects];
                        newProj[idx].name = e.target.value;
                        handleUpdate('projects', newProj);
                   }} /></div>
                   <div className="pe-input"><label>Tech Stack</label><input value={(proj.tech_stack || []).join(', ')} onChange={e => {
                        const newProj = [...editedProfile?.projects];
                        newProj[idx].tech_stack = e.target.value.split(',').map(s => s.trim());
                        handleUpdate('projects', newProj);
                   }} /></div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'strategy' && (
            <div className="pe-form-section">
              <h3>Role-Based Profile Variants</h3>
              <div className="pe-input">
                <label>ML Engineer Variant</label>
                <textarea rows={2} value={editedProfile.profile_variants?.ml_engineer || ''} onChange={e => handleUpdate('profile_variants.ml_engineer', e.target.value)} />
              </div>
              <div className="pe-input">
                <label>Cybersecurity Variant</label>
                <textarea rows={2} value={editedProfile.profile_variants?.cybersecurity || ''} onChange={e => handleUpdate('profile_variants.cybersecurity', e.target.value)} />
              </div>
              <div className="pe-input">
                <label>Backend Variant</label>
                <textarea rows={2} value={editedProfile.profile_variants?.backend || ''} onChange={e => handleUpdate('profile_variants.backend', e.target.value)} />
              </div>

              <h3>ATS Keyword Bank</h3>
              <div className="pe-input">
                <label>Keywords (Comma separated)</label>
                <input value={(editedProfile.ats_keywords || []).join(', ')} onChange={e => handleUpdate('ats_keywords', e.target.value.split(',').map(s => s.trim()))} />
              </div>

              <h3>Cover Letter Strategic Targets</h3>
              <div className="pe-input">
                <label>ML Role Template</label>
                <textarea rows={4} value={editedProfile.cover_letter_templates?.ml_role || ''} onChange={e => handleUpdate('cover_letter_templates.ml_role', e.target.value)} />
              </div>
              <div className="pe-input">
                <label>Cybersecurity Role Template</label>
                <textarea rows={4} value={editedProfile.cover_letter_templates?.cybersecurity_role || ''} onChange={e => handleUpdate('cover_letter_templates.cybersecurity_role', e.target.value)} />
              </div>
              <div className="pe-input">
                <label>Default Strategy</label>
                <textarea rows={4} value={editedProfile.cover_letter_templates?.default || ''} onChange={e => handleUpdate('cover_letter_templates.default', e.target.value)} />
              </div>
            </div>
          )}

          {activeTab === 'answers' && (
            <div className="pe-form-section">
              <h3>Screening Question Templates</h3>
              <div className="pe-input">
                <label>Why should we hire you?</label>
                <textarea rows={5} value={editedProfile.screening_answers?.why_should_we_hire_you || ''} onChange={e => handleUpdate('screening_answers.why_should_we_hire_you', e.target.value)} />
              </div>
              <div className="pe-input">
                <label>Key Strengths</label>
                <input value={(editedProfile.screening_answers?.strengths || []).join(', ')} onChange={e => handleUpdate('screening_answers.strengths', e.target.value.split(',').map(s => s.trim()))} />
              </div>
              <div className="pe-input">
                <label>Known Weaknesses</label>
                <input value={(editedProfile.screening_answers?.weaknesses || []).join(', ')} onChange={e => handleUpdate('screening_answers.weaknesses', e.target.value.split(',').map(s => s.trim()))} />
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="pe-form-section">
              <h3>Job Preferences</h3>
              <div className="pe-input">
                <label>Target Roles</label>
                <input value={(editedProfile.job_preferences?.roles || []).join(', ')} onChange={e => handleUpdate('job_preferences.roles', e.target.value.split(',').map(s => s.trim()))} />
              </div>
              <div className="pe-inline-group">
                <div className="pe-input">
                  <label>Current Salary</label>
                  <input value={editedProfile.salary_details?.current_salary || ''} onChange={e => handleUpdate('salary_details.current_salary', e.target.value)} />
                </div>
                <div className="pe-input">
                  <label>Expected (Negotiable)</label>
                  <input value={editedProfile.salary_details?.expected_salary || ''} onChange={e => handleUpdate('salary_details.expected_salary', e.target.value)} />
                </div>
              </div>
              <div className="pe-input">
                <label>Remote Policy</label>
                <select 
                    value={editedProfile.job_preferences?.remote ? 'remote' : 'onsite'} 
                    onChange={e => handleUpdate('job_preferences.remote', e.target.value === 'remote')}
                >
                  <option value="remote">Fully Remote / Hybrid</option>
                  <option value="onsite">On-Site Only</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileEditor;
