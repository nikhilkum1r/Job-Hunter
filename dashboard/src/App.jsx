import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  Activity, Search, CheckCircle, XCircle, Play, Pause, Zap, 
  BarChart3, Database, ExternalLink, Info, X, Settings, 
  Cpu, Radar, Shield, TrendingUp, AlertTriangle, Layers, User,
  Mail, Users, Terminal, Send, Trash2
} from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, LineElement, PointElement } from 'chart.js';
import { Bar, Line, Pie } from 'react-chartjs-2';
import ProfileEditor from './components/ProfileEditor';
import './App.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, ArcElement);

function App() {
  const [stats, setStats] = useState({ totalJobs: 0, applied: 0, failed: 0, pending: 0, inProgress: 0, skipped: 0, totalAttempts: 0, emailQueued: 0, contacts: 0, emailPending: 0 });
  const [config, setConfig] = useState({ 
    sleepDisabled: false, 
    maxWorkers: 3, 
    discoveryInterval: 120000, 
    stealthLevel: 3, 
    deepDiscovery: false 
  });
  const [jobs, setJobs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [logs, setLogs] = useState(["COMMAND_CENTER: Booting God-Mode Interface..."]);
  const [isRunning, setIsRunning] = useState(false);
  const [query, setQuery] = useState("Software Engineer");
  const [targetSource, setTargetSource] = useState('ALL');
  const [protocol, setProtocol] = useState('BALANCED'); // STEALTH, BALANCED, TURBO
  const [strategy, setStrategy] = useState("System idling. Awaiting mission parameters...");
  const [selectedJob, setSelectedJob] = useState(null);
  const [activeTab, setActiveTab] = useState('mission'); // 'mission', 'crm', 'emails', 'manual'
  const [contacts, setContacts] = useState([]);
  const [emailQueue, setEmailQueue] = useState([]);
  const [manualList, setManualList] = useState([]);
  const parseFeedback = (job) => {
    try {
      const data = job?.filled_data ? JSON.parse(job.filled_data) : null;
      return data?.__feedback || data || null;
    } catch {
      return null;
    }
  };
  
  const [currentTime, setCurrentTime] = useState(new Date());
  const [missionStart, setMissionStart] = useState(null);
  
  const logContainerRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isRunning && !missionStart) setMissionStart(Date.now());
    if (!isRunning) setMissionStart(null);
  }, [isRunning]);

  const getMissionDuration = () => {
    if (!missionStart) return "00:00:00";
    const diff = Math.floor((Date.now() - missionStart) / 1000);
    const h = Math.floor(diff / 3600).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
    const s = (diff % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await axios.get('/api/stats');
        setStats(res.data.stats);
        setJobs(res.data.jobs);
      } catch (err) { }
    };

    const fetchConfig = async () => {
        try {
          const res = await axios.get('/api/config');
          setConfig(res.data);
        } catch (err) {}
    };

    const fetchProfile = async () => {
        try {
            const res = await axios.get('/api/profile');
            setProfile(res.data);
        } catch (err) {}
    };

    const fetchCRM = async () => {
        try {
          const res = await axios.get('/api/crm/contacts');
          setContacts(res.data);
        } catch (err) {}
    };

    const fetchEmails = async () => {
        try {
          const res = await axios.get('/api/email/queue');
          setEmailQueue(res.data);
        } catch (err) {}
    };

    const fetchManual = async () => {
        try {
          const res = await axios.get('/api/manual-list');
          setManualList(res.data);
        } catch (err) {}
    };

    fetchStats();
    fetchConfig();
    fetchProfile();
    fetchCRM();
    fetchEmails();
    fetchManual();
    const interval = setInterval(() => {
        fetchStats();
        if (activeTab === 'crm') fetchCRM();
        if (activeTab === 'emails') fetchEmails();
        if (activeTab === 'manual') fetchManual();
    }, 3000);
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    const sse = new window.EventSource('/api/logs');
    sse.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.log) {
        setLogs(prev => [...prev.slice(-150), data.log]);
        
        // Extract live strategy from logs
        if (data.log.includes('STRATEGY_INIT')) setStrategy("Analyzing job market landscape...");
        if (data.log.includes('AUTH_MODE')) setStrategy("Authenticating portal sessions...");
        if (data.log.includes('DIRECT_MODE')) setStrategy("Bypassing portal aggregators. Engaging company direct.");
        if (data.log.includes('MATCHING')) setStrategy("Performing DeepAI skill intersection analysis...");
        if (data.log.includes('SUCCESS')) setStrategy("Mission parameter achieved. Storing application payload.");
      }
    };
    return () => sse.close();
  }, []);

  useEffect(() => {
    if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [logs]);

  const updateConfig = async (newConfig) => {
    try {
      const res = await axios.post('/api/config', newConfig);
      setConfig(res.data);
      setLogs(prev => [...prev, `SYSTEM_SYNC: Parameters updated (${Object.keys(newConfig).join(', ')})`]);
    } catch (err) {}
  };

  const startAgent = async () => {
    setIsRunning(true);
    setLogs(prev => [...prev, `HYPER_START: Initiating targeted discovery mission [${targetSource}] for "${query}"`]);
    try {
      await axios.post('/api/start', { query, source: targetSource, protocol });
    } catch (e) {
      setLogs(prev => [...prev, "CRITICAL_ERR: Connection to Hive Master severed."]);
      setIsRunning(false);
    }
  };

  const resetStuck = async () => {
    try {
      const res = await axios.post('/api/reset-stuck');
      setLogs(prev => [...prev, `MAINTENANCE: ${res.data.message}`]);
    } catch (e) { setLogs(prev => [...prev, 'RESET_ERR: Failed to reset stuck jobs.']); }
  };

  const stopAgent = async () => {
    try {
      setLogs(prev => [...prev, 'SIGNAL: Emitting GRACEFUL_STOP to Hive pool...']);
      await axios.post('/api/stop');
      setIsRunning(false);
    } catch (e) { setIsRunning(false); }
  };

  const executeCommand = async (command) => {
    setLogs(prev => [...prev, `COMMAND_SENT: ${command}`]);
    try {
       const res = await axios.post('/api/commands/execute', { command });
       setLogs(prev => [...prev, `COMMAND_RES: ${res.data.message}`]);
    } catch (e) {
       setLogs(prev => [...prev, "COMMAND_ERR: Execution failed."]);
    }
  };

  const barData = {
    labels: ['Found', 'Applied', 'Failed', 'Skipped', 'Emailed', 'Contacts'],
    datasets: [{
      label: 'Performance',
      data: [stats.totalJobs, stats.applied, stats.failed, stats.skipped || 0, stats.emailQueued || 0, stats.contacts || 0],
      backgroundColor: ['#6366f1', '#10b981', '#ef4444', '#a855f7', '#f59e0b', '#06b6d4'],
      borderRadius: 12,
      borderWidth: 0,
    }]
  };

  const getSystemStatusClass = () => {
    if (!isRunning) return 'standby';
    if (strategy.includes('Analyzing')) return 'searching';
    if (strategy.includes('authenticating') || strategy.includes('payload')) return 'applying';
    return 'active';
  };

  return (
    <div className={`app-container ${getSystemStatusClass()}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-icon"><Zap size={18} fill="white" /></div>
          <div className="brand-text">
            <h3 style={{margin: 0, fontSize: '0.9rem', letterSpacing: '1px'}}>HORIZON</h3>
            <span style={{fontSize: '0.6rem', color: 'var(--accent)', fontWeight: 800}}>PRO-COMMAND</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-item ${activeTab === 'mission' ? 'active' : ''}`} onClick={() => setActiveTab('mission')}>
            <Radar size={18} /> <span>Mission Hub</span>
          </button>
          <button className={`nav-item ${activeTab === 'crm' ? 'active' : ''}`} onClick={() => setActiveTab('crm')}>
            <Users size={18} /> <span>Contact CRM</span>
          </button>
          <button className={`nav-item ${activeTab === 'emails' ? 'active' : ''}`} onClick={() => setActiveTab('emails')}>
            <Mail size={18} /> <span>Email Queue</span>
          </button>
          <button className={`nav-item ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')}>
            <Activity size={18} /> <span>Interventions</span>
          </button>
          <div style={{marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--border)'}}>
            <button className="nav-item" onClick={() => setShowProfile(true)}>
              <User size={18} /> <span>My Profile</span>
            </button>
          </div>
        </nav>
      </aside>

      <main className="main-content">
        <header>
          <div className="header-inner">
            <div className="header-info">
              <div className="logo-icon" style={{width: '38px', height: '38px', background: 'var(--accent)', boxShadow: isRunning ? '0 0 20px var(--accent)' : 'none'}}>
                 <Zap size={20} fill="white" className={isRunning ? 'pulse' : ''} />
              </div>
              <div className="brand-text">
                <h2 style={{margin: 0, fontSize: '1rem', fontWeight: 800, letterSpacing: '1px'}}>HORIZON COMMAND</h2>
                <span style={{fontSize: '0.6rem', color: isRunning ? 'var(--success)' : 'var(--text-dim)', fontWeight: 800}}>
                  {isRunning ? 'MISSION IN PROGRESS' : 'SYSTEMS READY'}
                </span>
              </div>
              {isRunning && (
                <div style={{width: '30px', height: '30px', opacity: 0.6}}>
                  <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="var(--accent)" strokeWidth="2" opacity="0.3" />
                    <line x1="50" y1="50" x2="50" y2="5" stroke="var(--accent)" strokeWidth="3">
                      <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="2s" repeatCount="indefinite" />
                    </line>
                  </svg>
                </div>
              )}
            </div>

            <div className="header-center">
               <div className="search-box">
                  <Search size={16} className="search-icon" />
                  <input 
                    type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                    placeholder="Target Role (e.g. Lead ML Engineer)..." disabled={isRunning}
                    style={{fontSize: '0.85rem'}}
                  />
               </div>
            </div>

            <div className="header-actions">
               <div className="telemetry-item" style={{marginRight: '1.5rem', textAlign: 'right', opacity: 0.8}}>
                  <div style={{fontSize: '0.6rem', color: 'var(--text-dim)', fontWeight: 800}}>MISSION ELAPSED</div>
                  <div style={{fontFamily: 'var(--font-data)', color: 'var(--accent)', fontSize: '0.9rem'}}>{getMissionDuration()}</div>
               </div>
               <div className="telemetry-item" style={{marginRight: '2.5rem', textAlign: 'right', opacity: 0.8, borderLeft: '1px solid var(--border)', paddingLeft: '1.5rem'}}>
                  <div style={{fontSize: '0.6rem', color: 'var(--text-dim)', fontWeight: 800}}>SYSTEM TIME</div>
                  <div style={{fontFamily: 'var(--font-data)', color: 'var(--text-main)', fontSize: '0.9rem'}}>
                    {currentTime.toLocaleTimeString([], {hour12: false})}
                  </div>
               </div>
               {isRunning ? (
                 <button className="btn-primary" style={{background: 'var(--error)', padding: '0.6rem 1.5rem'}} onClick={stopAgent}>
                   <Pause size={16} fill="white" /> TERMINATE MISSION
                 </button>
               ) : (
                 <button className="btn-primary" style={{padding: '0.6rem 1.5rem'}} onClick={startAgent}>
                   <Play size={16} fill="white" /> ENGAGE SYSTEM
                 </button>
               )}
            </div>
          </div>
        </header>

        <section className="dashboard-view">
          {activeTab === 'mission' && (
            <>
              <div className="view-main" style={{display: 'flex', flexDirection: 'column', gap: '2fr'}}>
                <div className="pro-card telemetry-box">
                   <div className="card-label"><Terminal size={14} /> Mission Intelligence Feed</div>
                   <div className="log-stream" ref={logContainerRef}>
                      {logs.length > 0 ? logs.map((log, i) => (
                        <div key={i} className={`log-line ${log.includes('SUCCESS') ? 'ok' : log.includes('ERR') ? 'err' : ''}`}>
                          <span className="timestamp">[{new Date().toLocaleTimeString([], {hour12: false})}]</span> {log}
                        </div>
                      )) : (
                        <div style={{color: 'var(--text-dim)', textAlign: 'center', marginTop: '4rem', opacity: 0.5}}>
                           <Database size={32} style={{marginBottom: '1rem'}} />
                           <p>AWAITING INTERFACE LINK...</p>
                        </div>
                      )}
                   </div>
                </div>

                <div className="pro-card" style={{flex: 1}}>
                  <div className="card-label"><Layers size={14} /> Deployment Statistics</div>
                  <div className="job-scroll">
                     {jobs.length > 0 ? jobs.map((job, i) => (
                       <div key={i} className="job-row" onClick={() => setSelectedJob(job)}>
                          <div className="job-info">
                            <h4 style={{textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '300px'}}>{job.title}</h4>
                            <p>{job.company} • <span style={{color: 'var(--accent)'}}>{job.source}</span></p>
                          </div>
                          <div className={`status-badge ${job.status?.toLowerCase() || 'pending'}`}>
                             {job.status || 'QUEUED'}
                          </div>
                       </div>
                     )) : (
                        <div style={{color: 'var(--text-dim)', textAlign: 'center', padding: '4rem', opacity: 0.5}}>
                           <Layers size={32} style={{marginBottom: '1rem'}} />
                           <p>NODE DEPLOYMENT MATRIX IDLE</p>
                        </div>
                     )}
                  </div>
                </div>
              </div>

              <div className="view-side" style={{display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '320px'}}>
                <div className="pro-card">
                  <div className="card-label"><Shield size={14} /> Flight Parameters</div>
                  <div className="flight-grid">
                     <div className="control-row">
                        <div className="control-header">
                          <label>Discovery Matrix</label>
                          <span>{targetSource}</span>
                        </div>
                        <div className="protocol-strip">
                          {['ALL', 'LINKEDIN', 'INDEED', 'NAUKRI'].map(src => (
                            <button 
                              key={src} 
                              className={`p-toggle ${targetSource === src ? 'active' : ''}`}
                              onClick={() => setTargetSource(src)}
                              style={{fontSize: '0.55rem'}}
                            >
                              {src === 'LINKEDIN' ? 'LNKD' : src === 'INDEED' ? 'INDD' : src === 'NAUKRI' ? 'NAUK' : 'ALL'}
                            </button>
                          ))}
                        </div>
                     </div>

                     <div className="control-row">
                        <div className="control-header">
                          <label>Strategy Protocol</label>
                          <span>{protocol}</span>
                        </div>
                        <div className="protocol-strip">
                          {['STEALTH', 'BALANCED', 'TURBO'].map(p => (
                            <button 
                              key={p} 
                              className={`p-toggle ${protocol === p ? 'active' : ''}`}
                              onClick={() => {
                                setProtocol(p);
                                updateConfig({ protocol: p });
                              }}
                            >
                              {p.slice(0, 1)}
                            </button>
                          ))}
                        </div>
                     </div>

                     <div className="control-row">
                         <div className="control-header">
                           <label>Worker Hive</label>
                           <span>{config.maxWorkers} Threads</span>
                         </div>
                         <input 
                           type="range" min="1" max="8" 
                           value={config.maxWorkers} 
                           onChange={(e) => updateConfig({ maxWorkers: parseInt(e.target.value) })}
                         />
                      </div>
                     <div className="control-row">
                         <div className="control-header">
                           <label>Match Threshold</label>
                           <span>{config.matchThreshold || 45}%</span>
                         </div>
                         <input
                           type="range" min="20" max="90"
                           value={config.matchThreshold || 45}
                           onChange={(e) => updateConfig({ matchThreshold: parseInt(e.target.value) })}
                         />
                      </div>
                  </div>
                </div>

                 <div className="pro-card">
                    <div className="card-label"><Cpu size={14} /> Live Intelligence</div>
                    <div style={{padding: '1rem', background: 'rgba(0,0,0,0.2)', margin: '1rem', borderRadius: '8px'}}>
                       <div style={{color: 'var(--accent)', fontFamily: 'var(--font-data)', fontSize: '0.8rem', marginBottom: '1rem'}}>
                          {strategy}
                       </div>
                       <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.65rem'}}>
                         <div style={{background: 'rgba(16,185,129,0.1)', padding: '0.5rem', borderRadius: '6px', textAlign: 'center'}}>
                           <div style={{color: 'var(--success)', fontWeight: 800, fontSize: '1.1rem'}}>{stats.applied}</div>
                           <div style={{color: 'var(--text-dim)'}}>APPLIED</div>
                         </div>
                         <div style={{background: 'rgba(239,68,68,0.1)', padding: '0.5rem', borderRadius: '6px', textAlign: 'center'}}>
                           <div style={{color: 'var(--error)', fontWeight: 800, fontSize: '1.1rem'}}>{stats.failed}</div>
                           <div style={{color: 'var(--text-dim)'}}>FAILED</div>
                         </div>
                         <div style={{background: 'rgba(245,158,11,0.1)', padding: '0.5rem', borderRadius: '6px', textAlign: 'center'}}>
                           <div style={{color: '#f59e0b', fontWeight: 800, fontSize: '1.1rem'}}>{stats.emailQueued || 0}</div>
                           <div style={{color: 'var(--text-dim)'}}>EMAILED</div>
                         </div>
                         <div style={{background: 'rgba(6,182,212,0.1)', padding: '0.5rem', borderRadius: '6px', textAlign: 'center'}}>
                           <div style={{color: '#06b6d4', fontWeight: 800, fontSize: '1.1rem'}}>{stats.contacts || 0}</div>
                           <div style={{color: 'var(--text-dim)'}}>CONTACTS</div>
                         </div>
                       </div>
                    </div>
                    <div style={{padding: '0 1rem 1rem'}}>
                      <button className="btn-secondary" style={{width: '100%', fontSize: '0.65rem', justifyContent: 'center'}} onClick={resetStuck}>
                        ↺ RESET STUCK JOBS
                      </button>
                    </div>
                 </div>
              </div>
            </>
          )}

          {activeTab === 'crm' && (
            <div className="pro-card" style={{gridColumn: 'span 2'}}>
               <div className="card-label"><Users size={14} /> Industry Network Hub</div>
               <div className="job-scroll">
                  {contacts.length > 0 ? contacts.map((c, i) => (
                    <div key={i} className="job-row">
                       <div className="job-info">
                          <h4>{c.email}</h4>
                          <p>{c.company || 'Direct Entity'} • {c.source}</p>
                       </div>
                       <div className="status-badge applied">{JSON.parse(c.interaction_history || '[]').length} CONTACTS</div>
                    </div>
                  )) : (
                    <div className="inert-card">
                       <Users size={48} />
                       <div>
                          <p style={{fontSize: '0.9rem'}}>CRM DATABASE INERT</p>
                          <small>DISCOVER CONTACTS DURING MISSION TO POPULATE</small>
                       </div>
                    </div>
                  )}
               </div>
            </div>
          )}

          {activeTab === 'emails' && (
            <div className="pro-card" style={{gridColumn: 'span 2'}}>
               <div className="card-label"><Mail size={14} /> Outbound Pipeline Control</div>
               <div className="job-scroll">
                  {emailQueue.length > 0 ? emailQueue.map((e, i) => (
                    <div key={i} className="job-row">
                       <div className="job-info">
                          <h4>{e.subject}</h4>
                          <p>To: {e.to_email} • {new Date(e.created_at).toLocaleDateString()}</p>
                       </div>
                       <div className={`status-badge ${e.status.toLowerCase()}`}>{e.status}</div>
                    </div>
                  )) : (
                    <div className="inert-card">
                       <Mail size={48} />
                       <div>
                          <p style={{fontSize: '0.9rem'}}>OUTBOUND PIPELINE FLUSHED</p>
                          <small>NO PENDING CORRESPONDENCE DETECTED</small>
                       </div>
                    </div>
                  )}
               </div>
            </div>
          )}
          {activeTab === 'manual' && (
            <div className="pro-card" style={{gridColumn: 'span 2'}}>
               <div className="card-label"><Activity size={14} /> Manual Intervention Registry</div>
               <div className="job-scroll">
                  {manualList.length > 0 ? manualList.map((m, i) => (
                    <div key={i} className="job-row">
                       <div className="job-info">
                          <h4>{m.title}</h4>
                          <p>{m.company} • {m.reason}</p>
                       </div>
                       <a href={m.url} target="_blank" rel="noreferrer" className="btn-secondary" style={{fontSize: '0.7rem'}}>
                          INTERVENE <ExternalLink size={14} />
                       </a>
                    </div>
                  )) : (
                     <div className="inert-card">
                        <Activity size={48} />
                        <div>
                           <p style={{fontSize: '0.9rem'}}>NO ACTIVE INTERVENTIONS</p>
                           <small>SYSTEM IS OPERATING AUTONOMOUSLY</small>
                        </div>
                     </div>
                  )}
               </div>
            </div>
          )}
        </section>
      </main>

      {showProfile && profile && (
          <div className="pro-modal-overlay" onClick={() => setShowProfile(false)}>
              <div className="pro-modal" style={{background: '#0a0a0c'}} onClick={e => e.stopPropagation()}>
                <ProfileEditor 
                    profile={profile} 
                    onSave={(p) => { setProfile(p); setShowProfile(false); }} 
                    onClose={() => setShowProfile(false)} 
                />
              </div>
          </div>
      )}

      {selectedJob && (
        <div className="pro-modal-overlay" onClick={() => setSelectedJob(null)}>
            <div className="pro-modal" onClick={e => e.stopPropagation()}>
                <div style={{padding: '1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <div className="job-info">
                        <h2 style={{margin: 0}}>{selectedJob.title}</h2>
                        <p>{selectedJob.company} • {selectedJob.location}</p>
                    </div>
                    <button onClick={() => setSelectedJob(null)} className="btn-secondary"><X size={20} /></button>
                </div>
                <div style={{padding: '2rem', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem', overflowY: 'auto'}}>
                    <div className="m-evidence">
                        {selectedJob.screenshot_path ? (
                            <img 
                              src={`http://localhost:5000/screenshots/${selectedJob.screenshot_path}`} 
                              alt="Evidence" 
                              style={{width: '100%', borderRadius: '12px', border: '1px solid var(--border)'}}
                            />
                        ) : (
                            <div style={{height: '300px', background: '#000', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)'}}>
                              NO VISUAL EVIDENCE CAPTURED
                            </div>
                        )}
                    </div>
                    <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
                        {parseFeedback(selectedJob)?.stages && (
                          <div style={{background: '#000', padding: '1rem', borderRadius: '12px'}}>
                            <h4 style={{marginTop: 0, fontSize: '0.7rem', color: 'var(--text-dim)'}}>EXECUTION FEEDBACK</h4>
                            <div style={{fontSize: '0.8rem', color: 'var(--accent)', whiteSpace: 'pre-wrap'}}>
                              {parseFeedback(selectedJob).stages.join(' -> ')}
                            </div>
                            {selectedJob.error_log && (
                              <div style={{marginTop: '0.8rem', color: '#f59e0b', fontSize: '0.75rem'}}>
                                {selectedJob.error_log}
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent)'}}>
                            MATCH SCORE: {selectedJob.match_score}%
                        </div>
                        <div style={{background: '#000', padding: '1.5rem', borderRadius: '12px'}}>
                            <h4 style={{marginTop: 0, fontSize: '0.7rem', color: 'var(--text-dim)'}}>DATA PAYLOAD</h4>
                            <pre style={{margin: 0, fontSize: '0.8rem', color: 'var(--accent)', overflowX: 'auto'}}>
                              {selectedJob.filled_data ? JSON.stringify(JSON.parse(selectedJob.filled_data), null, 2) : 'No payload captured'}
                            </pre>
                        </div>
                        <a href={selectedJob.url} target="_blank" rel="noreferrer" className="btn-primary" style={{textAlign: 'center', justifyContent: 'center'}}>
                            OPEN LIVE PORTAL <ExternalLink size={16} />
                        </a>
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

export default App;
