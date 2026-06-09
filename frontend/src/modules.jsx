    const { useState, useEffect, useRef } = React;

    // ===== ICON COMPONENT (Material Symbols Outlined) =====
    const Ico = ({ n, s = 16, c = {} }) => {
      const m = { logout:'logout', sun:'light_mode', moon:'dark_mode', users:'group', user:'person', settings:'settings', layers:'stacked_line_chart', file:'description', plug:'extension', link:'link', bulb:'lightbulb', phone:'call', save:'save', pencil:'edit', check:'check', x:'close', alert:'warning', clock:'schedule', alarm:'timer', pin:'push_pin', star:'star', trending:'trending_up', download:'download', upload:'upload', message:'chat_bubble', plus:'add', chart:'bar_chart', funnel:'filter_alt', zap:'bolt', door:'meeting_room' };
      return <span className="material-symbols-outlined" style={{ fontSize: s + 2, lineHeight: 1, verticalAlign: 'middle', flexShrink: 0, display: 'inline-block', ...c }}>{m[n] || n}</span>;
    };

    // ===== SLA HELPERS =====
    const calculateSLAHours = (deadlineStr) => {
      if(!deadlineStr) return null;
      return (new Date(deadlineStr).getTime() - new Date().getTime()) / (1000 * 60 * 60);
    };
    const determineSLAType = (deadlineStr) => {
      const diff = calculateSLAHours(deadlineStr);
      if(diff === null) return 'none';
      if(diff < 0) return 'danger';
      if(diff <= 2) return 'warning';
      return 'safe';
    };

    // ===== INITIAL DATA =====
    const initialPipelines = [
      { id: 'p1', name: 'Asosiy B2C Sotuvlar' },
      { id: 'p2', name: 'B2B Hamkorlik' }
    ];
    const initialColumns = {
      'p1': [
        { id: 'NEW', title: 'Yangi Lead' },
        { id: 'CONTACTED', title: 'Aloqa qilindi' },
        { id: 'QUALIFIED', title: 'Ehtiyoj aniqlandi' },
        { id: 'PROPOSAL', title: 'Taklif yuborildi' },
        { id: 'NEGOTIATION', title: 'Muzokaralar' },
        { id: 'WON', title: 'Yutildi ✅' },
        { id: 'LOST', title: 'Muvaffaqiyatsiz 🚫' },
      ],
      'p2': [
        { id: 'NEW', title: 'Korporativ Lead' },
        { id: 'MEETING', title: 'Uchrashuv' },
        { id: 'CONTRACT', title: 'Shartnoma' },
        { id: 'WON', title: 'Zafarabod' }
      ]
    };

    // Demo lead ma'lumotlari olib tashlandi — har bir kompaniya null holatdan boshlanadi
    const initialLeads = [];

    // ===== HELPERS =====
    const getInitials = (name) => {
      if(!name) return '?';
      const p = name.trim().split(' ');
      return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name[0].toUpperCase();
    };
    const colColors = { NEW:'#6366f1', CONTACTED:'#3b82f6', QUALIFIED:'#8b5cf6', PROPOSAL:'#f59e0b', NEGOTIATION:'#f97316', WON:'#01a750', LOST:'#ef4444', MEETING:'#06b6d4', CONTRACT:'#8b5cf6' };

    // ===== DASHBOARD =====
    const DashboardOverview = ({ leads, role, setSelectedLeadId }) => {
      const lostLeads = leads.filter(l => l.status === 'LOST');
      const wonLeads = leads.filter(l => l.status === 'WON');
      const tasksDanger = leads.filter(l => determineSLAType(l.deadline) === 'danger');
      const activeLeads = leads.filter(l => l.deadline);
      const [viewModal, setViewModal] = useState({ state: false, title: '', items: [], withImportExport: false });
      const openDrillDown = (title, itemsArr, impExp) => setViewModal({ state: true, title, items: itemsArr, withImportExport: impExp });

      // Kompaniya xodimlarini API dan yuklash (KPI uchun)
      const [companyUsers, setCompanyUsers] = useState([]);
      useEffect(() => {
        const token = localStorage.getItem('mizon_token');
        if (!token) return;
        fetch('/api/company/users', { headers: { 'Authorization': 'Bearer ' + token } })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (Array.isArray(d)) setCompanyUsers(d); })
          .catch(() => {});
      }, []);

      const p1Leads = leads.filter(l => l.pipelineId === 'p1');
      const stages = ['NEW','CONTACTED','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST'];
      const stageLabels = { NEW:'Yangi', CONTACTED:'Aloqa', QUALIFIED:'Ehtiyoj', PROPOSAL:'Taklif', NEGOTIATION:'Muzokara', WON:'Yutildi', LOST:'Lost' };
      const maxCount = Math.max(1, ...stages.map(s => p1Leads.filter(l => l.status === s).length));

      const metrics = [
        { title: "Jami Leadlar", value: leads.length, icon: 'people', color: '#6366f1', bg: 'rgba(99,102,241,0.1)', items: leads, impExp: true },
        { title: "Muvaffaqiyatli", value: wonLeads.length, icon: 'emoji_events', color: '#01a750', bg: 'rgba(1,167,80,0.1)', items: wonLeads, impExp: false },
        { title: "Yo'qotilgan", value: lostLeads.length, icon: 'cancel', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', items: lostLeads, impExp: false },
        { title: "Kechikkan", value: tasksDanger.length, icon: 'timer_off', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', items: tasksDanger, impExp: false },
        { title: "Faol Vazifalar", value: activeLeads.length, icon: 'task_alt', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', items: activeLeads, impExp: false },
      ];

      return (
        <div style={{display:'flex', flexDirection:'column', gap:'22px'}}>
          <div>
            <h2 style={{fontSize:'21px', fontWeight:700, letterSpacing:'-0.5px'}}>
              {role === 'CEO' ? 'Boshqaruv paneli' : 'Mening KPIm'}
            </h2>
            <p style={{fontSize:'12px', color:'var(--text-muted)', marginTop:'4px'}}>
              {new Date().toLocaleDateString('uz-UZ', {weekday:'long', year:'numeric', month:'long', day:'numeric'})}
            </p>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:'12px'}}>
            {metrics.map((m, i) => (
              <div key={i} className="card clickable" onClick={() => openDrillDown(m.title, m.items, m.impExp)} style={{padding:'16px'}}>
                <div style={{width:'36px', height:'36px', borderRadius:'9px', background:m.bg, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'12px'}}>
                  <span className="material-symbols-outlined" style={{fontSize:'19px', color:m.color}}>{m.icon}</span>
                </div>
                <div style={{fontSize:'10px', textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-muted)', fontWeight:600, fontFamily:'var(--font-label)', marginBottom:'5px'}}>{m.title}</div>
                <div style={{fontSize:'26px', fontWeight:700, letterSpacing:'-0.03em', color: i===1?'#01a750': i===2?'#ef4444': i===3?'#f59e0b':'var(--text-main)'}}>{m.value}</div>
              </div>
            ))}
          </div>

          <div style={{display:'grid', gridTemplateColumns: role === 'CEO' ? '1fr 1fr' : '1fr', gap:'14px'}}>
            <div className="card">
              <div className="card-title" style={{marginBottom:'14px'}}>Asosiy varonka holati</div>
              {stages.map(s => {
                const cnt = p1Leads.filter(l => l.status === s).length;
                return (
                  <div key={s} className="chart-bar-row">
                    <span className="chart-bar-label">{stageLabels[s]}</span>
                    <div className="chart-bar-track">
                      <div className="chart-bar-fill" style={{width: (cnt/maxCount*100)+'%', background:colColors[s]||'var(--primary-container)'}}></div>
                    </div>
                    <span className="chart-bar-val">{cnt}</span>
                  </div>
                );
              })}
            </div>

            {role === 'CEO' && (
              <div className="card">
                <div className="card-title" style={{marginBottom:'14px'}}>Sotuvchi xodimlar (KPI)</div>
                {companyUsers.length === 0 ? (
                  <div style={{textAlign:'center', padding:'20px', color:'var(--text-muted)', fontSize:'13px'}}>
                    Xodimlar yuklanmoqda...
                  </div>
                ) : (
                  <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                    {companyUsers.map(u => {
                      const mLeads = leads.filter(l => l.owner === u.username);
                      const mWon   = mLeads.filter(l => l.status === 'WON').length;
                      const mLost  = mLeads.filter(l => l.status === 'LOST').length;
                      const roleLabel = u.role === 'CEO' ? 'CEO' : u.role === 'MANAGER' ? 'Menejer' : u.role;
                      const statusLabel = u.is_active === false ? 'Nofaol' : 'Faol';
                      return (
                        <div key={u.id || u.username} style={{padding:'14px', background:'var(--bg-base)', borderRadius:'10px', border:'1px solid var(--border-light)'}}>
                          <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'12px'}}>
                            <div className="avatar" style={{width:'36px', height:'36px', fontSize:'13px'}}>
                              {(u.full_name || u.username)[0].toUpperCase()}
                            </div>
                            <div>
                              <div style={{fontWeight:600, fontSize:'14px'}}>{u.full_name || u.username}</div>
                              <div style={{fontSize:'11px', color:'var(--text-muted)'}}>{roleLabel} • {statusLabel}</div>
                            </div>
                          </div>
                          <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'8px', textAlign:'center'}}>
                            {[
                              ['Jami',    mLeads.length, 'var(--text-main)', 'var(--surface-variant)'],
                              ['Yutildi', mWon,          '#01a750',          'rgba(1,167,80,0.1)'],
                              ['Lost',    mLost,         '#ef4444',          'rgba(239,68,68,0.08)']
                            ].map(([label, val, clr, bg]) => (
                              <div key={label} style={{padding:'8px', background:bg, borderRadius:'8px'}}>
                                <div style={{fontSize:'20px', fontWeight:700, color:clr}}>{val}</div>
                                <div style={{color:'var(--text-muted)', fontSize:'10px', marginTop:'2px'}}>{label}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {viewModal.state && (
            <div className="login-overlay">
              <div className="large-modal-box">
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:'20px', alignItems:'center'}}>
                  <h2 style={{fontSize:'18px', fontWeight:700}}>{viewModal.title}</h2>
                  <button className="btn-outline" onClick={()=>setViewModal({...viewModal, state:false})}><Ico n="x" s={13}/> Yopish</button>
                </div>
                {viewModal.withImportExport && (
                  <div style={{display:'flex', gap:'10px', marginBottom:'18px', paddingBottom:'16px', borderBottom:'1px solid var(--border-light)'}}>
                    <button className="btn-outline"><Ico n="download" s={13}/> Excel Import</button>
                    <button className="btn-outline"><Ico n="upload" s={13}/> Export</button>
                  </div>
                )}
                <table>
                  <thead>
                    <tr><th>ID</th><th>Mijoz</th><th>Mas'ul</th><th>SLA</th><th>Holat</th></tr>
                  </thead>
                  <tbody>
                    {viewModal.items.length === 0 && <tr><td colSpan="5" style={{textAlign:'center', padding:'20px', color:'var(--text-muted)'}}>Ma'lumot topilmadi</td></tr>}
                    {viewModal.items.map(l => (
                      <tr key={l.id} style={{cursor:'pointer'}} onClick={()=>{setViewModal({...viewModal, state:false}); setSelectedLeadId(l.id);}}>
                        <td style={{color:'var(--text-muted)', fontSize:'12px'}}>#{l.id}</td>
                        <td style={{fontWeight:600, color:'var(--accent)'}}>{l.name}</td>
                        <td><span style={{background:'var(--surface-variant)', padding:'2px 8px', borderRadius:'10px', fontSize:'11px'}}>{l.owner}</span></td>
                        <td style={{fontSize:'12px'}}>{l.deadline ? <span style={{color:determineSLAType(l.deadline)==='danger'?'var(--danger)':'inherit'}}>{new Date(l.deadline).toLocaleString()}</span> : <span style={{color:'var(--text-muted)'}}>—</span>}</td>
                        <td><span style={{fontSize:'11px', fontWeight:600, padding:'2px 8px', borderRadius:'4px', background:(colColors[l.status]||'#888')+'22', color:colColors[l.status]||'var(--text-muted)'}}>{l.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    };

    // ===== PIPELINE EDITOR =====
    const PipelineEditor = ({ pipelines, setPipelines, columnsMap, setColumnsMap, stageMapRef, onStagesUpdated }) => {
      const [pId, setPId] = useState(pipelines[0]?.id);
      const pipe = pipelines.find(p => p.id === pId);
      const [localCols, setLocalCols] = useState(columnsMap[pId] || []);
      const [isAddingPipe, setIsAddingPipe] = useState(false);
      const [newPipeName, setNewPipeName] = useState('');
      const [saving, setSaving] = useState(false);
      useEffect(() => { setLocalCols(columnsMap[pId] || []); }, [pId, columnsMap]);
      if(!pipe) return null;
      const addCol = () => setLocalCols([...localCols, {id:'STAGE_'+Date.now(), title:'Yangi bosqich'}]);
      const updateColTitle = (id, val) => setLocalCols(localCols.map(c => c.id===id?{...c,title:val}:c));
      const removeCol = (id) => {
        if(localCols.length <= 1) return alert("Kamida 1 bosqich bo'lishi shart!");
        setLocalCols(localCols.filter(c => c.id!==id));
      };
      const savePipe = async () => {
        setSaving(true);
        // 1. Lokalga saqlash
        setColumnsMap({...columnsMap,[pId]:localCols});
        // 2. DB ga saqlash (faqat asosiy pipeline p1)
        const token = localStorage.getItem('mizon_token');
        if (token) {
          try {
            // Har bir col uchun: agar stageMapRef.current.toDbId[col.id] mavjud bo'lsa — mavjud bosqich (DB ID bilan)
            const toDbId = stageMapRef?.current?.toDbId || {};
            const stageData = localCols.map((col, i) => {
              const dbId = toDbId[col.id]; // undefined → yangi bosqich
              return {
                ...(dbId != null ? { id: dbId } : {}),
                name: col.title,
                sequence: i + 1,
                is_won: col.id === 'WON',
                is_lost: col.id === 'LOST',
              };
            });
            const r = await fetch('/api/stages/sync', {
              method: 'PUT',
              headers: {'Content-Type':'application/json','Authorization':'Bearer '+token},
              body: JSON.stringify({ stages: stageData }),
            });
            const d = await r.json();
            if (d.success && onStagesUpdated) onStagesUpdated(d.stages);
            alert(d.success ? "✅ Bosqichlar saqlandi!" : "❌ " + (d.error || 'Xato'));
          } catch(e) {
            alert("❌ Server xatosi: " + e.message);
          }
        } else {
          alert("Bosqichlar lokal saqlandi.");
        }
        setSaving(false);
      };
      const updateName = (e) => setPipelines(pipelines.map(p => p.id===pId?{...p,name:e.target.value}:p));
      const deletePipe = () => {
        if(pipelines.length<=1) return alert("Ohirgi quvurni o'chira olmaysiz!");
        if(!confirm("Haqiqatdan ham bu quvurni o'chirasizmi?")) return;
        const newList = pipelines.filter(p => p.id!==pId);
        setPipelines(newList); setPId(newList[0].id);
      };
      const createNewPipelineForm = () => {
        if(!newPipeName) return alert("Quvur nomini kiriting!");
        const newId = 'pipe_'+Date.now();
        setPipelines([...pipelines,{id:newId,name:newPipeName}]);
        setColumnsMap({...columnsMap,[newId]:[{id:'STAGE_'+Date.now(),title:'Yangi bosqich'}]});
        setPId(newId); setIsAddingPipe(false); setNewPipeName('');
      };
      return (
        <div style={{display:'flex', flexDirection:'column', gap:'16px'}}>
          <div style={{padding:'20px', background:'var(--bg-hover)', border:'1px solid var(--border-light)', borderRadius:'8px'}}>
            <span className="label-sm">Tahrirlanadigan Quvur:</span>
            <select className="input-base" style={{marginBottom:'12px'}} value={pId} onChange={e=>setPId(e.target.value)}>
              {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="label-sm">Quvur nomi:</span>
            <input className="input-base" value={pipe.name} onChange={updateName} />
            <span className="label-sm" style={{marginTop:'8px'}}>Bosqichlar:</span>
            <div style={{display:'flex', flexDirection:'column', gap:'7px', marginBottom:'14px'}}>
              {localCols.map((col, idx) => (
                <div key={col.id} style={{display:'flex', gap:'8px', alignItems:'center'}}>
                  <span style={{padding:'8px', color:'var(--text-muted)', fontSize:'12px', width:'24px'}}>{idx+1}</span>
                  <input className="input-base" style={{marginBottom:0, flex:1}} value={col.title} onChange={e=>updateColTitle(col.id, e.target.value)} />
                  <button className="btn-danger" style={{padding:'7px 10px'}} onClick={()=>removeCol(col.id)}>O'chirish</button>
                </div>
              ))}
              <button className="btn-outline" onClick={addCol}>+ Bosqich Qo'shish</button>
            </div>
            <div style={{display:'flex', justifyContent:'space-between', borderTop:'1px solid var(--border-light)', paddingTop:'14px'}}>
              <button className="btn-primary" onClick={savePipe} disabled={saving}>{saving?'Saqlanmoqda...':'Saqlash'}</button>
              <button className="btn-danger" onClick={deletePipe}>Quvurni O'chirish</button>
            </div>
          </div>
          {isAddingPipe ? (
            <div style={{padding:'16px', background:'var(--bg-hover)', border:'1px dashed var(--border-light)', borderRadius:'8px'}}>
              <span className="label-sm">Yangi quvur nomi:</span>
              <input className="input-base" placeholder="Asosiy savdolar yoki VIP..." value={newPipeName} onChange={e=>setNewPipeName(e.target.value)} />
              <div style={{display:'flex', gap:'8px'}}>
                <button className="btn-success" onClick={createNewPipelineForm}>Yaratish</button>
                <button className="btn-outline" onClick={()=>setIsAddingPipe(false)}>Bekor qilish</button>
              </div>
            </div>
          ) : (
            <button className="btn-outline" style={{width:'100%', padding:'12px'}} onClick={()=>setIsAddingPipe(true)}>+ Yangi Pipeline Yaratish</button>
          )}
        </div>
      );
    };

    // ===== USER MANAGEMENT =====
    const UserManagement = ({ users, setUsers }) => {
      const [isAdding, setIsAdding] = useState(false);
      const [editId,   setEditId]   = useState(null);
      const [form,     setForm]     = useState({username:'', password:'', role:'MANAGER', email:''});
      const [apiUsers, setApiUsers] = useState(null); // null = not fetched yet
      const [saving,   setSaving]   = useState(false);
      const token = localStorage.getItem('mizon_token');
      const authH = token ? {'Content-Type':'application/json','Authorization':'Bearer '+token} : {'Content-Type':'application/json'};

      // Load users from API
      const loadApiUsers = () => {
        if (!token) return;
        fetch('/api/company/users', {headers: authH})
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (Array.isArray(d)) setApiUsers(d); })
          .catch(() => {});
      };
      useEffect(() => { loadApiUsers(); }, []);

      const displayUsers = apiUsers !== null ? apiUsers : users;

      const saveNewUser = async () => {
        if (!form.username || !form.password) return alert("Barcha qatorlarni to'ldiring!");
        setSaving(true);
        if (token) {
          const r = await fetch('/api/company/users', {method:'POST', headers:authH, body:JSON.stringify(form)});
          const d = await r.json();
          if (!r.ok) { alert(d.error || 'Xato'); setSaving(false); return; }
          loadApiUsers();
        } else {
          setUsers([...users, {...form, id:Date.now().toString()}]);
        }
        setSaving(false); setIsAdding(false); setForm({username:'',password:'',role:'MANAGER'});
      };

      const deleteU = async (u) => {
        if (!window.confirm(`"${u.username}" ni o'chirasizmi?`)) return;
        if (token && u.id) {
          await fetch(`/api/company/users/${u.id}`, {method:'DELETE', headers:authH});
          loadApiUsers();
        } else {
          setUsers(users.filter(us => us.username !== u.username));
        }
      };

      const saveEdit = async () => {
        if (token && editId) {
          const r = await fetch(`/api/company/users/${editId}`, {method:'PUT', headers:authH, body:JSON.stringify(form)});
          if (!r.ok) { const d=await r.json(); alert(d.error||'Xato'); return; }
          loadApiUsers();
        } else {
          setUsers(users.map(u => u.username===form.username ? form : u));
        }
        setEditId(null);
      };

      return (
        <div style={{marginTop:'8px'}}>
          <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
            {displayUsers.map(u => {
              const uid = u.id || u.username;
              if (editId === uid) return (
                <div key={uid} style={{padding:'12px', background:'var(--bg-hover)', border:'1px solid var(--border-light)', borderRadius:'8px', display:'flex', gap:'8px', flexWrap:'wrap'}}>
                  <input className="input-base" style={{marginBottom:0,flex:1,minWidth:'100px'}} value={form.username} disabled />
                  <input className="input-base" style={{marginBottom:0,flex:1,minWidth:'120px'}} placeholder="Yangi parol (ixtiyoriy)" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} />
                  <select className="input-base" style={{marginBottom:0}} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
                    <option value="MANAGER">MANAGER</option>
                    <option value="CEO">CEO</option>
                    <option value="WATCHER">KUZATUVCHI</option>
                  </select>
                  <button className="btn-primary" onClick={saveEdit}>Saqlash</button>
                  <button className="btn-outline" onClick={()=>setEditId(null)}>Bekor</button>
                </div>
              );
              const roleColor = {CEO:'#01a750', MANAGER:'#3b82f6', WATCHER:'#8b5cf6'}[u.role] || '#888';
              return (
                <div key={uid} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 14px', background:'var(--bg-base)', border:'1px solid var(--border-light)', borderRadius:'8px'}}>
                  <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                    <div className="avatar" style={{width:'34px', height:'34px', fontSize:'13px', background:`${roleColor}22`, color:roleColor}}>{u.username[0].toUpperCase()}</div>
                    <div>
                      <div style={{fontWeight:600, color:'var(--accent)'}}>{u.username}</div>
                      <div style={{fontSize:'11px', color:'var(--text-muted)', display:'flex', gap:'6px', alignItems:'center'}}>
                        <span style={{padding:'1px 7px', borderRadius:'10px', fontSize:'10px', fontWeight:700, background:`${roleColor}18`, color:roleColor}}>{u.role==='WATCHER'?'KUZATUVCHI':u.role}</span>
                        {u.full_name && u.full_name!==u.username && <span>{u.full_name}</span>}
                        {u.email && <span>{u.email}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{display:'flex', gap:'8px'}}>
                    <button className="btn-outline" style={{padding:'6px 12px'}} onClick={()=>{setEditId(uid);setForm({username:u.username,password:'',role:u.role||'MANAGER'});}}>Tahrirlash</button>
                    <button className="btn-danger" style={{padding:'6px 12px'}} onClick={()=>deleteU(u)}>O'chirish</button>
                  </div>
                </div>
              );
            })}
          </div>
          {isAdding ? (
            <div style={{padding:'16px', background:'var(--bg-hover)', border:'1px solid var(--border-light)', borderRadius:'8px', marginTop:'14px', display:'flex', flexDirection:'column', gap:'6px'}}>
              <span className="label-sm">Yangi Xodim Ma'lumotlari</span>
              <input className="input-base" placeholder="Login (username)" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} />
              <input className="input-base" placeholder="Email (login uchun)" type="email" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})} />
              <input className="input-base" placeholder="Maxfiy parol" type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} />
              <select className="input-base" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
                <option value="MANAGER">MANAGER (Sotuvchi)</option>
                <option value="CEO">CEO (Boshqaruvchi)</option>
                <option value="WATCHER">KUZATUVCHI (Faqat ko'rish)</option>
              </select>
              <div style={{display:'flex', gap:'8px'}}>
                <button className="btn-primary" onClick={saveNewUser} disabled={saving}>{saving?'Saqlanmoqda...':'Qo\'shish'}</button>
                <button className="btn-outline" onClick={()=>setIsAdding(false)}>Bekor qilish</button>
              </div>
            </div>
          ) : (
            <button className="btn-outline" style={{marginTop:'14px'}} onClick={()=>{setForm({username:'',password:'',role:'MANAGER',email:''});setIsAdding(true);}}>+ Yangi xodim qo'shish</button>
          )}
        </div>
      );
    };

    // ===== GLOBAL LIMITS =====
    const GlobalLimitsConfig = ({ globalCallLimit, setGlobalCallLimit }) => {
      const [tlimit, setTlimit] = useState(globalCallLimit);
      const [saving, setSaving] = useState(false);
      const [saved,  setSaved]  = useState(false);

      const saveLimit = async () => {
        setSaving(true);
        try {
          const t = localStorage.getItem('mizon_token');
          const r = await fetch('/api/company/settings', {
            method:'PUT',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+t},
            body: JSON.stringify({ call_limit: tlimit }),
          });
          const d = await r.json();
          if (d.success) {
            setGlobalCallLimit(tlimit);
            localStorage.setItem('mizon_callLimit', String(tlimit));
            setSaved(true); setTimeout(()=>setSaved(false), 2500);
          } else { alert('❌ ' + (d.error || 'Saqlashda xato')); }
        } catch(e) { alert('❌ Server xatosi'); }
        setSaving(false);
      };

      return (
        <div style={{padding:'20px', background:'var(--bg-hover)', border:'1px solid var(--border-light)', borderRadius:'8px'}}>
          <span className="label-sm">Avtomatik LOST Limit (Call Limit)</span>
          <p style={{fontSize:'12px', color:'var(--text-muted)', marginBottom:'16px'}}>
            Ushbu raqam mijoz bilan bog'lanish uchun berilgan maksimal urinishlar soni. Limit tugasa tizim mijozni LOST statusiga o'tkazadi.
          </p>
          <div style={{display:'flex', gap:'12px', alignItems:'center'}}>
            <input type="number" className="input-base" style={{marginBottom:0, width:'100px', fontSize:'18px'}} value={tlimit} min={1} max={50} onChange={e=>setTlimit(Number(e.target.value))} />
            <button className="btn-primary" onClick={saveLimit} disabled={saving} style={{minWidth:'110px'}}>
              {saving ? 'Saqlanmoqda...' : saved ? '✅ Saqlandi!' : 'Tasdiqlash'}
            </button>
          </div>
        </div>
      );
    };

    // ===== INTEGRATIONS =====
    const IntegrationsModule = ({ formSettings, setFormSettings, formFields, setFormFields }) => {
      const [configs,     setConfigs]     = useState(() => { try { return JSON.parse(localStorage.getItem('mizon_integrations')||'{}'); } catch{return {};} });
      const [apiKeys,     setApiKeys]     = useState(() => { try { return JSON.parse(localStorage.getItem('mizon_api_keys_local')||'[]'); } catch{return [];} });
      // Pipelines list (for webform link generation)
      const [intgPipelines] = useState(() => { try { return JSON.parse(localStorage.getItem('mizon_pipelines')||'[]'); } catch{return [];} });
      // Company slug (subdomain → URL param → session dan ketma-ket qidirish)
      const intgCompanySlug = (() => {
        // 1. Subdomain: kompaniya.mizon-crm.uz
        const host = window.location.hostname;
        const DOMAIN = 'mizon-crm.uz';
        if (host !== DOMAIN && host !== 'www.'+DOMAIN && host.endsWith('.'+DOMAIN)) {
          const sub = host.slice(0, host.length - DOMAIN.length - 1);
          if (sub && sub !== 'www') return sub;
        }
        // 2. URL parametr: ?company=slug
        const urlSlug = new URLSearchParams(window.location.search).get('company');
        if (urlSlug) return urlSlug;
        // 3. Kirgan foydalanuvchining session ma'lumotlaridan
        try {
          const session = JSON.parse(localStorage.getItem('mizon_session') || 'null');
          if (session?.companySlug) return session.companySlug;
        } catch {}
        return '';
      })();
      const [activeModal, setActiveModal] = useState(null);
      const [formData,    setFormData]    = useState({});
      const [copiedItem,  setCopiedItem]  = useState(null);
      const [msg,         setMsg]         = useState('');
      const [saving,      setSaving]      = useState(false);

      const authH = () => {
        const t = localStorage.getItem('mizon_token');
        return {'Content-Type':'application/json', 'Authorization':'Bearer '+t};
      };

      // Load existing integrations from backend on mount
      useEffect(() => {
        const H = {'Authorization':'Bearer '+localStorage.getItem('mizon_token')};

        // API tomonidan boshqariladigan barcha platformalar
        // Bu ro'yxatdagi platformalar faqat DB dan yuklanadi — localStorage dagi eskilar tozalanadi
        const API_PLATFORMS = ['facebook','instagram','telegram','webhook','google_sheets'];

        // Load platform integrations
        fetch('/api/integrations', {headers:H}).then(r=>r.ok?r.json():null).then(list => {
          if (!Array.isArray(list)) return;
          const loaded = {};
          list.forEach(cfg => {
            if (['facebook','instagram'].includes(cfg.platform)) {
              if (!loaded[cfg.platform]) loaded[cfg.platform] = [];
              loaded[cfg.platform].push({
                id:            cfg.id,
                page_id:       cfg.page_id || '',
                form_id:       cfg.form_id || '',
                _connected_at: cfg.created_at || new Date().toISOString(),
                ...(cfg.extra_config || {}),
              });
            } else {
              loaded[cfg.platform] = {
                page_id:       cfg.page_id      || '',
                form_id:       cfg.form_id      || '',
                _connected_at: cfg.created_at   || new Date().toISOString(),
                ...(cfg.extra_config || {}),
              };
            }
          });
          setConfigs(prev => {
            // localStorage dagi eski platform ma'lumotlarini tozalash,
            // so'ng faqat DB dan kelganlarni qo'yish
            const cleaned = {...prev};
            API_PLATFORMS.forEach(p => { delete cleaned[p]; });
            const merged = {...cleaned, ...loaded};
            localStorage.setItem('mizon_integrations', JSON.stringify(merged));
            return merged;
          });
        }).catch(()=>{});

        // Load VoIP config
        fetch('/api/voip/config', {headers:H}).then(r=>r.ok?r.json():null).then(d => {
          setConfigs(prev => {
            const upd = {...prev};
            if (d?.configured) {
              // VoIP ulangan — ma'lumotlarni yangilash
              upd.voip = { account_id:d.account_id, caller_id:d.caller_id, domain:d.domain, _connected_at:d.created_at||new Date().toISOString() };
            } else {
              // VoIP ulangan emas — localStorage dagi eski ma'lumotni o'chirish
              delete upd.voip;
            }
            localStorage.setItem('mizon_integrations', JSON.stringify(upd));
            return upd;
          });
        }).catch(()=>{});

        // Load API keys
        fetch('/api/api-keys', {headers:H}).then(r=>r.ok?r.json():null).then(list => {
          if (!Array.isArray(list)) return;
          const keys = list.map(k=>({id:k.id, token:k.key_value||k.label, created_at:k.created_at}));
          if (keys.length) { setApiKeys(keys); localStorage.setItem('mizon_api_keys_local', JSON.stringify(keys)); }
        }).catch(()=>{});
      }, []);

      const flash = (m) => { setMsg(m); setTimeout(()=>setMsg(''), 3200); };
      const copyText = (text, id) => {
        navigator.clipboard?.writeText(text).catch(()=>{});
        setCopiedItem(id); setTimeout(()=>setCopiedItem(null), 2000);
      };

      const saveConfig = async (key, data) => {
        setSaving(true);
        const intgName = ALL_INTG.find(i=>i.key===key)?.name || key;
        try {
          let ok = false;
          if (key === 'voip') {
            // VoIP: dedicated endpoint
            const r = await fetch('/api/voip/config', {method:'POST', headers:authH(), body:JSON.stringify({
              account_id: data.account_id, api_token: data.api_token,
              caller_id: data.caller_id, domain: data.domain||'app.moizvonki.ru',
            })});
            ok = r.ok;
            if (!r.ok) { const e=await r.json(); throw new Error(e.error||'Server xatosi'); }
          } else if (key === 'telegram') {
            // Telegram: register webhook with Telegram Bot API
            const r = await fetch('/api/integrations/telegram/setup', {method:'POST', headers:authH(), body:JSON.stringify({
              bot_token: data.bot_token, chat_id: data.chat_id||'',
            })});
            const d = await r.json();
            if (!r.ok) throw new Error(d.error||'Telegram webhook ro\'yxatdan o\'tmadi');
            ok = true;
          } else {
            // Facebook, Instagram, Custom Webhook
            const r = await fetch('/api/integrations', {method:'POST', headers:authH(), body:JSON.stringify({
              platform:      key,
              page_id:       data.page_id       || data.account_id || null,
              form_id:       data.form_id        || null,
              access_token:  data.access_token   || null,
              field_mapping: data._fm            || {},   // AmoCRM-style field mapping
              extra_config:  {name: data.name, secret: data.secret, account_id: data.account_id},
            })});
            ok = r.ok;
            if (!r.ok) { const e=await r.json(); throw new Error(e.error||'Server xatosi'); }
          }
          const updated = {...configs, [key]: {...data, _connected_at: new Date().toISOString()}};
          setConfigs(updated); localStorage.setItem('mizon_integrations', JSON.stringify(updated));
          flash('✅ ' + intgName + ' integratsiyasi saqlandi');
        } catch(e) {
          flash('❌ ' + e.message);
        }
        setSaving(false);
        setActiveModal(null);
      };

      const disconnectIntg = async (key) => {
        if (!window.confirm('Integratsiyani uzasizmi?')) return;
        try {
          if (key !== 'voip' && key !== 'telegram') {
            await fetch(`/api/integrations/${encodeURIComponent(key)}`, {method:'DELETE', headers:authH()});
          }
        } catch {}
        const updated = {...configs}; delete updated[key];
        setConfigs(updated); localStorage.setItem('mizon_integrations', JSON.stringify(updated));
        flash('🔌 Integratsiya uzildi'); setActiveModal(null);
      };

      const openModal = (intg) => {
        const saved = configs[intg.key] || {};
        // Load saved field mapping or default for Facebook
        const fm = saved._fm || (intg.showMapping ? {...DEFAULT_FM} : {});
        setFormData({...saved, _fm: fm});
        setActiveModal(intg);
      };
      const genApiKey = async () => {
        const token = 'mzk_'+Math.random().toString(36).substr(2,14)+Date.now().toString(36);
        try {
          const r = await fetch('/api/api-keys', {method:'POST', headers:authH(), body:JSON.stringify({service:'mizon_crm', label:'API Key '+new Date().toLocaleDateString(), key_value:token})});
          if (r.ok) {
            const k = await r.json();
            const upd = [...apiKeys, {id:k.id||Date.now(), token:k.label||token, created_at:k.created_at||new Date().toISOString()}];
            setApiKeys(upd); localStorage.setItem('mizon_api_keys_local', JSON.stringify(upd));
            return;
          }
        } catch {}
        // Fallback: local only
        const k = {id:Date.now(), token, created_at:new Date().toISOString()};
        const upd = [...apiKeys, k]; setApiKeys(upd); localStorage.setItem('mizon_api_keys_local', JSON.stringify(upd));
      };
      const delApiKey = async (id) => {
        try { await fetch(`/api/api-keys/${id}`, {method:'DELETE', headers:authH()}); } catch {}
        const upd = apiKeys.filter(k=>k.id!==id); setApiKeys(upd); localStorage.setItem('mizon_api_keys_local', JSON.stringify(upd));
      };

      const origin = window.location.origin;

      // AmoCRM uslubida Facebook maydon nomlari → CRM maydonlari moslash
      const FB_FIELDS = [
        {fb:'full_name',    lbl:'Ism va familiya (full_name)'},
        {fb:'first_name',   lbl:'Ism (first_name)'},
        {fb:'last_name',    lbl:'Familiya (last_name)'},
        {fb:'email',        lbl:'Elektron pochta (email)'},
        {fb:'phone_number', lbl:'Telefon raqami (phone_number)'},
        {fb:'city',         lbl:'Shahar (city)'},
        {fb:'country',      lbl:'Mamlakat (country)'},
        {fb:'company_name', lbl:'Kompaniya (company_name)'},
        {fb:'job_title',    lbl:'Lavozim (job_title)'},
        {fb:'comments',     lbl:'Izoh/xabar (comments)'},
      ];
      const CRM_OPTS = [
        {v:'',           l:'— O\'tkazib yuborish —'},
        {v:'name',       l:'Ism (name)'},
        {v:'email',      l:'Email'},
        {v:'phone',      l:'Telefon (phone)'},
        {v:'region',     l:'Hudud / Shahar'},
        {v:'company',    l:'Kompaniya'},
        {v:'note',       l:'Izoh / Vazifa tavsifi'},
      ];
      // Default field mapping (Odoo crm.lead uslubi)
      const DEFAULT_FM = {full_name:'name', email:'email', phone_number:'phone', city:'region', company_name:'company', comments:'note'};

      const ALL_INTG = [
        { key:'telegram',  name:'Telegram Bot', logo:'✈️', color:'#0088cc', bg:'rgba(0,136,204,0.12)',
          desc:'Bot orqali leadlarni avtomatik qabul qiling va mijozlarga xabar yuboring',
          fields:[
            {k:'bot_token', label:'Bot Token — @BotFather dan /newbot buyrug\'i orqali oling', ph:'7123456789:AAFxyz...', t:'text'},
            {k:'chat_id',   label:'Admin Chat ID — sizga xabarnomalar keladigan chat (ixtiyoriy)', ph:'-100123456789 yoki 123456789', t:'text'},
          ],
          wh:{label:'Webhook — saqlash tugmasini bossangiz avtomatik ro\'yxatdan o\'tkaziladi', url:`${origin}/api/webhook/telegram`} },

        { key:'instagram', name:'Instagram', logo:'📸', color:'#E4405F', bg:'rgba(228,64,95,0.12)',
          desc:'Instagram Direct xabarlardan avtomatik lead yaratish — maydon moslash shart emas',
          igNote:true,
          fields:[
            {k:'access_token', label:'Page Access Token — Meta Business Suite → Sozlamalar → API', ph:'EAABwzLjNMZB...', t:'password'},
            {k:'account_id',   label:'Instagram Business Account ID (Sahifangizning IG ID si)', ph:'17841400000000000', t:'text'},
          ],
          wh:{label:'Webhook URL — Meta Developer Dashboard → Webhooks ga kiriting', url:`${origin}/api/webhook/meta`},
          verifyToken:'mizon_meta_webhook_v1' },

        { key:'facebook', name:'Facebook Ads', logo:'👥', color:'#1877F2', bg:'rgba(24,119,242,0.12)',
          desc:'Lead Ads formalarini real-time CRM ga yuklash — maydon moslash bilan',
          showMapping:true,
          fields:[
            {k:'access_token', label:'Page Access Token — Meta Business Suite → Sozlamalar → API', ph:'EAABwzLjNMZB...', t:'password'},
            {k:'page_id',      label:'Facebook Page ID — sahifa sozlamalaridan topasiz', ph:'123456789012345', t:'text'},
            {k:'form_id',      label:'Lead Form ID — ixtiyoriy (bo\'sh = barcha formalar qabul qilinadi)', ph:'', t:'text'},
          ],
          wh:{label:'Webhook URL — Meta Developer Dashboard → Webhooks → leadgen ga kiriting', url:`${origin}/api/webhook/meta`},
          verifyToken:'mizon_meta_webhook_v1' },

        { key:'webhook', name:'Custom Webhook', logo:'🔗', color:'#6366f1', bg:'rgba(99,102,241,0.12)',
          desc:'Istalgan sayt yoki tizimdan POST so\'rov orqali lead yuborish imkoniyati',
          fields:[
            {k:'name',   label:'Integratsiya nomi', ph:'Mening saytim', t:'text'},
            {k:'secret', label:'Secret Key (ixtiyoriy)', ph:'Auto-yaratiladi', t:'text'},
          ],
          wh:{label:'Lead qabul qilish endpoint (POST so\'rov)', url:`${origin}/api/leads`} },

        { key:'voip', name:'Moizvonki VoIP', logo:'📞', color:'#01a750', bg:'rgba(1,167,80,0.12)',
          desc:'IP-telefon, avtomatik qo\'ng\'iroq qayd etish va Call Center statistikasi',
          fields:[
            {k:'account_id', label:'Account ID — Moizvonki kabinetidagi login', ph:'user@moizvonki.ru', t:'text'},
            {k:'api_token',  label:'API Token — Moizvonki → Sozlamalar → API', ph:'your-api-token', t:'password'},
            {k:'caller_id',  label:'Caller ID — chiquvchi qo\'ng\'iroqlar uchun raqam', ph:'+998901234567', t:'text'},
            {k:'domain',     label:'Domain', ph:'app.moizvonki.ru', t:'text'},
          ],
          wh:{label:'Callback Webhook — Moizvonki kabinetiga kiriting', url:`${origin}/api/webhook/moizvonki`} },

        { key:'google_sheets', name:'Google Sheets', logo:'📊', color:'#0f9d58', bg:'rgba(15,157,88,0.12)',
          desc:'Facebook Lead Ads → Google Sheets → CRM: Apps Script orqali avtomatik sinxronizatsiya',
          customUI: true },
      ];

      const cfgIsOn = (key) => { const c = configs[key]; return Array.isArray(c) ? c.length > 0 : !!c; };
      const cfgCount = (key) => { const c = configs[key]; return Array.isArray(c) ? c.length : (cfgIsOn(key) ? 1 : 0); };
      const connected = ALL_INTG.filter(i => cfgIsOn(i.key));

      // ── Card component ──────────────────────────────────────────────
      const IntgCard = ({intg}) => {
        const isOn  = cfgIsOn(intg.key);
        const count = cfgCount(intg.key);
        return (
          <div onClick={()=>openModal(intg)} style={{background:'var(--bg-surface)', border:`1px solid ${isOn?intg.color+'50':'var(--outline-variant)'}`, borderRadius:'13px', padding:'18px', cursor:'pointer', transition:'border-color 0.18s, box-shadow 0.18s', position:'relative', overflow:'hidden'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=intg.color+'90'; e.currentTarget.style.boxShadow=`0 4px 18px ${intg.color}25`;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=isOn?intg.color+'50':'var(--outline-variant)'; e.currentTarget.style.boxShadow='none';}}>
            {isOn && <div style={{position:'absolute',top:'12px',right:'12px',width:'8px',height:'8px',borderRadius:'50%',background:'#01a750',boxShadow:'0 0 0 3px rgba(1,167,80,0.2)'}}></div>}
            <div style={{width:'46px',height:'46px',background:intg.bg,borderRadius:'12px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',marginBottom:'12px'}}>{intg.logo}</div>
            <div style={{fontWeight:700,fontSize:'14px',marginBottom:'5px'}}>{intg.name}</div>
            <div style={{fontSize:'12px',color:'var(--text-muted)',lineHeight:'1.55',marginBottom:'14px',minHeight:'36px'}}>{intg.desc}</div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:'10px',fontWeight:700,padding:'3px 9px',borderRadius:'20px',background:isOn?'rgba(1,167,80,0.14)':'var(--surface-variant)',color:isOn?'#01a750':'var(--text-muted)',border:isOn?'1px solid rgba(1,167,80,0.3)':'1px solid transparent'}}>
                {isOn ? (count > 1 ? `● ${count} ta ulangan` : '● Ulangan') : '○ Ulanmagan'}
              </span>
              <span style={{fontSize:'12px',color:intg.color,fontWeight:600}}>{isOn ? (count > 1 ? `+Ulash →` : 'Tahrirlash →') : 'Ulash →'}</span>
            </div>
          </div>
        );
      };

      // ── Divider with label ──────────────────────────────────────────
      const Divider = ({label}) => (
        <div style={{display:'flex',alignItems:'center',gap:'12px',margin:'8px 0 16px'}}>
          <div style={{flex:1,height:'1px',background:'var(--outline-variant)'}}></div>
          <span style={{fontSize:'10px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.1em',whiteSpace:'nowrap'}}>{label}</span>
          <div style={{flex:1,height:'1px',background:'var(--outline-variant)'}}></div>
        </div>
      );

      return (
        <div style={{maxWidth:'920px',margin:'0 auto'}}>
          {msg && <div style={{background:msg.startsWith('✅')?'rgba(1,167,80,0.1)':'rgba(239,68,68,0.08)',border:`1px solid ${msg.startsWith('✅')?'rgba(1,167,80,0.3)':'rgba(239,68,68,0.3)'}`,color:msg.startsWith('✅')?'#01a750':'#ef4444',padding:'10px 16px',borderRadius:'8px',marginBottom:'16px',fontSize:'13px'}}>{msg}</div>}

          {/* Header */}
          <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'26px'}}>
            <div style={{width:'42px',height:'42px',background:'rgba(1,167,80,0.12)',borderRadius:'11px',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <span className="material-symbols-outlined" style={{fontSize:'22px',color:'var(--primary)'}}>extension</span>
            </div>
            <div>
              <h2 style={{fontSize:'18px',fontWeight:700}}>Integratsiyalar</h2>
              <p style={{fontSize:'12px',color:'var(--text-muted)'}}>Messenger, reklama va tashqi tizimlarni ulang</p>
            </div>
          </div>

          {/* ── CONNECTED ─────────────────────────────────────── */}
          {connected.length > 0 && (
            <div style={{marginBottom:'28px'}}>
              <Divider label={`Ulangan platformalar (${connected.length})`} />
              <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                {connected.map(intg => {
                  const cfg = configs[intg.key];
                  return (
                    <div key={intg.key} style={{background:'var(--bg-surface)',border:`1px solid ${intg.color}40`,borderLeft:`3px solid ${intg.color}`,borderRadius:'10px',padding:'13px 18px',display:'flex',alignItems:'center',gap:'14px',flexWrap:'wrap'}}>
                      <div style={{width:'38px',height:'38px',background:intg.bg,borderRadius:'9px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'19px',flexShrink:0}}>{intg.logo}</div>
                      <div style={{flex:1,minWidth:'140px'}}>
                        <div style={{fontWeight:700,fontSize:'13px',display:'flex',alignItems:'center',gap:'7px'}}>
                          {intg.name}
                          <span style={{padding:'2px 7px',borderRadius:'20px',fontSize:'9px',fontWeight:700,background:'rgba(1,167,80,0.13)',color:'#01a750',border:'1px solid rgba(1,167,80,0.3)'}}>● FAOL</span>
                        </div>
                        <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'2px'}}>
                          {cfg?.name || intg.desc.split(',')[0]}
                          {cfg?._connected_at && <span style={{marginLeft:'8px',opacity:0.7}}>· {new Date(cfg._connected_at).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      {intg.wh && (
                        <div style={{display:'flex',alignItems:'center',gap:'6px',background:'var(--bg-base)',border:'1px solid var(--outline-variant)',borderRadius:'6px',padding:'4px 10px',flexShrink:0}}>
                          <code style={{fontSize:'10px',color:'var(--text-muted)',maxWidth:'180px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{intg.wh.url}</code>
                          <button onClick={e=>{e.stopPropagation();copyText(intg.wh.url,intg.key+'_wh');}} style={{background:'none',border:'none',cursor:'pointer',fontSize:'11px',padding:'0 2px',color:copiedItem===intg.key+'_wh'?'#01a750':'var(--text-muted)',fontWeight:700}}>
                            {copiedItem===intg.key+'_wh'?'✓':'📋'}
                          </button>
                        </div>
                      )}
                      <div style={{display:'flex',gap:'7px'}}>
                        <button className="btn-outline" style={{padding:'5px 13px',fontSize:'12px'}} onClick={()=>openModal(intg)}>✏️ Tahrirlash</button>
                        <button style={{padding:'5px 11px',fontSize:'12px',background:'none',border:'1px solid rgba(239,68,68,0.3)',color:'#ef4444',borderRadius:'7px',cursor:'pointer'}} onClick={()=>disconnectIntg(intg.key)}>Uzish</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── AVAILABLE GRID ────────────────────────────────── */}
          <Divider label="Barcha integratsiyalar" />
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:'13px',marginBottom:'28px'}}>
            {ALL_INTG.map(intg => <IntgCard key={intg.key} intg={intg}/>)}

            {/* API Keys card */}
            <div onClick={()=>setActiveModal('apikeys')} style={{background:'var(--bg-surface)',border:'1px solid var(--outline-variant)',borderRadius:'13px',padding:'18px',cursor:'pointer',transition:'border-color 0.18s,box-shadow 0.18s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(245,158,11,0.6)';e.currentTarget.style.boxShadow='0 4px 18px rgba(245,158,11,0.15)';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--outline-variant)';e.currentTarget.style.boxShadow='none';}}>
              <div style={{width:'46px',height:'46px',background:'rgba(245,158,11,0.12)',borderRadius:'12px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',marginBottom:'12px'}}>🔑</div>
              <div style={{fontWeight:700,fontSize:'14px',marginBottom:'5px'}}>API Kalitlar</div>
              <div style={{fontSize:'12px',color:'var(--text-muted)',lineHeight:'1.55',marginBottom:'14px',minHeight:'36px'}}>Sayt, 1C va tashqi dasturlar uchun xavfsiz kirish kalitlari</div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:'10px',fontWeight:700,padding:'3px 9px',borderRadius:'20px',background:'rgba(245,158,11,0.12)',color:'#f59e0b',border:'1px solid rgba(245,158,11,0.3)'}}>
                  {apiKeys.length} ta kalit
                </span>
                <span style={{fontSize:'12px',color:'#f59e0b',fontWeight:600}}>Boshqarish →</span>
              </div>
            </div>

            {/* Veb Forma Havolasi card */}
            <div onClick={()=>setActiveModal('webformlink')} style={{background:'var(--bg-surface)',border:'1px solid var(--outline-variant)',borderRadius:'13px',padding:'18px',cursor:'pointer',transition:'border-color 0.18s,box-shadow 0.18s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(139,92,246,0.6)';e.currentTarget.style.boxShadow='0 4px 18px rgba(139,92,246,0.15)';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--outline-variant)';e.currentTarget.style.boxShadow='none';}}>
              <div style={{width:'46px',height:'46px',background:'linear-gradient(135deg,rgba(90,223,129,0.15),rgba(139,92,246,0.15))',borderRadius:'12px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'22px',marginBottom:'12px'}}>🔗</div>
              <div style={{fontWeight:700,fontSize:'14px',marginBottom:'5px'}}>Tashqi Havola</div>
              <div style={{fontSize:'12px',color:'var(--text-muted)',lineHeight:'1.55',marginBottom:'14px',minHeight:'36px'}}>Mijozlar to'ldirishi uchun tashqi ro'yxatdan o'tish havolasini yarating</div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:'10px',fontWeight:700,padding:'3px 9px',borderRadius:'20px',background:'rgba(139,92,246,0.12)',color:'#8b5cf6',border:'1px solid rgba(139,92,246,0.3)'}}>
                  Veb Forma
                </span>
                <span style={{fontSize:'12px',color:'#8b5cf6',fontWeight:600}}>Havola olish →</span>
              </div>
            </div>
          </div>

          {/* ── INTEGRATION MODAL ─────────────────────────────── */}
          {activeModal && activeModal !== 'apikeys' && (() => {
            // ── Facebook OAuth multi-step flow ─────────────────────
            const FbOAuthFlow = () => {
              const [fbStep,   setFbStep]   = useState(0); // 0=list+btn, 1=waiting, 2=pages, 3=forms+mapping
              const [fbToken,  setFbToken]  = useState('');
              const [fbPages,  setFbPages]  = useState([]);
              const [fbPage,   setFbPage]   = useState(null);
              const [fbForms,  setFbForms]  = useState([]);
              const [fbForm,   setFbForm]   = useState(null);
              const [fbFm,     setFbFm]     = useState({...DEFAULT_FM});
              const [fbSaving, setFbSaving] = useState(false);
              const [loadingF, setLoadingF] = useState(false);
              const connList = Array.isArray(configs.facebook) ? configs.facebook : (configs.facebook ? [configs.facebook] : []);

              useEffect(() => {
                const handler = (e) => {
                  if (e.data?.type === 'fb_oauth_success') { setFbToken(e.data.token||''); setFbPages(e.data.pages||[]); setFbStep(2); }
                  else if (e.data?.type === 'fb_oauth_error') { flash('❌ Facebook: '+(e.data.error||'Xato')); setFbStep(0); }
                };
                window.addEventListener('message', handler);
                return () => window.removeEventListener('message', handler);
              }, []);

              const startFbOAuth = () => {
                const popup = window.open('/api/oauth/facebook/init', 'fb_oauth', 'width=600,height=700,left=200,top=100');
                if (!popup) { flash('❌ Popup bloklandi. Brauzer sozlamalarini tekshiring.'); return; }
                setFbStep(1);
              };

              const selectFbPage = async (pg) => {
                setFbPage(pg); setLoadingF(true); setFbForm(null);
                try {
                  const r = await fetch(`/api/oauth/facebook/forms?page_id=${pg.id}&page_token=${encodeURIComponent(pg.access_token)}`);
                  setFbForms(r.ok ? (await r.json()) : []);
                } catch { setFbForms([]); }
                setLoadingF(false); setFbStep(3);
              };

              const saveFb = async () => {
                if (!fbPage) return;
                setFbSaving(true);
                try {
                  const r = await fetch('/api/integrations', {method:'POST', headers:authH(), body:JSON.stringify({
                    platform:'facebook', page_id:fbPage.id, form_id:fbForm?.id||null,
                    access_token:fbPage.access_token, field_mapping:fbFm,
                    extra_config:{page_name:fbPage.name, form_name:fbForm?.name||''},
                  })});
                  const d = await r.json();
                  if (!r.ok) throw new Error(d.error||'Xato');
                  const newEntry = {id:d.id, page_id:fbPage.id, page_name:fbPage.name, form_id:fbForm?.id, form_name:fbForm?.name||'', _connected_at:new Date().toISOString()};
                  const newList  = [...connList, newEntry];
                  const updated  = {...configs, facebook: newList};
                  setConfigs(updated); localStorage.setItem('mizon_integrations', JSON.stringify(updated));
                  flash('✅ '+fbPage.name+' ulandi'); setFbStep(0); setFbPage(null); setFbForm(null);
                } catch(e) { flash('❌ '+e.message); }
                setFbSaving(false);
              };

              const disconnectFbPage = async (item) => {
                if (!window.confirm(`"${item.page_name||item.page_id}" ni uzasizmi?`)) return;
                if (item.id) { try { await fetch(`/api/integrations/id/${item.id}`,{method:'DELETE',headers:authH()}); } catch {} }
                const newList = connList.filter(p=>p!==item);
                const updated = {...configs};
                if (newList.length > 0) updated.facebook = newList;
                else delete updated.facebook;
                setConfigs(updated); localStorage.setItem('mizon_integrations',JSON.stringify(updated));
                flash(newList.length?`🔌 "${item.page_name||item.page_id}" uzildi`:'🔌 Facebook integratsiyasi uzildi');
              };

              return (
                <div style={{padding:'20px 22px'}}>
                  {/* Step 0: Connected list + OAuth button */}
                  {fbStep === 0 && (<>
                    {connList.length > 0 && (
                      <div style={{marginBottom:'14px'}}>
                        <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:'8px'}}>Ulangan sahifalar ({connList.length})</div>
                        {connList.map((p,i)=>(
                          <div key={p.id||i} style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 13px',background:'rgba(24,119,242,0.07)',border:'1px solid rgba(24,119,242,0.25)',borderRadius:'8px',marginBottom:'6px'}}>
                            <div style={{flex:1}}>
                              <div style={{fontWeight:600,fontSize:'13px'}}>{p.page_name||p.page_id}</div>
                              {p.form_name&&<div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'1px'}}>📋 {p.form_name}</div>}
                              {p._connected_at&&<div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'1px'}}>{new Date(p._connected_at).toLocaleDateString()}</div>}
                            </div>
                            <span style={{padding:'2px 8px',borderRadius:'20px',fontSize:'10px',fontWeight:700,background:'rgba(1,167,80,0.12)',color:'#01a750',border:'1px solid rgba(1,167,80,0.3)'}}>● Faol</span>
                            <button style={{padding:'4px 10px',fontSize:'11px',background:'none',border:'1px solid rgba(239,68,68,0.3)',color:'#ef4444',borderRadius:'6px',cursor:'pointer'}} onClick={()=>disconnectFbPage(p)}>Uzish</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Webhook URL */}
                    <div style={{background:'rgba(24,119,242,0.07)',border:'1px solid rgba(24,119,242,0.2)',borderRadius:'9px',padding:'10px 14px',marginBottom:'12px'}}>
                      <div style={{fontSize:'10px',fontWeight:700,color:'#1877F2',marginBottom:'5px',textTransform:'uppercase'}}>Webhook URL — Meta Developer → Webhooks → leadgen</div>
                      <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                        <code style={{flex:1,fontSize:'11px',color:'var(--text-main)',wordBreak:'break-all'}}>{origin}/api/webhook/meta</code>
                        <button onClick={()=>copyText(origin+'/api/webhook/meta','fb_wh')} style={{padding:'3px 9px',fontSize:'11px',fontWeight:700,background:copiedItem==='fb_wh'?'#01a750':'#1877F2',color:'white',border:'none',borderRadius:'5px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>
                          {copiedItem==='fb_wh'?'✓':'📋 Nusxa'}
                        </button>
                      </div>
                    </div>
                    <div style={{background:'var(--bg-base)',border:'1px solid var(--outline-variant)',borderRadius:'8px',padding:'9px 13px',marginBottom:'14px',display:'flex',alignItems:'center',gap:'10px'}}>
                      <span style={{fontSize:'10px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase'}}>Verify Token:</span>
                      <code style={{flex:1,fontSize:'12px',color:'var(--primary)',fontWeight:600}}>mizon_meta_webhook_v1</code>
                      <button onClick={()=>copyText('mizon_meta_webhook_v1','fbvt')} style={{padding:'2px 8px',fontSize:'10px',background:'var(--surface-variant)',border:'1px solid var(--outline-variant)',borderRadius:'4px',cursor:'pointer',color:copiedItem==='fbvt'?'#01a750':'var(--text-muted)',fontWeight:700}}>{copiedItem==='fbvt'?'✓':'📋'}</button>
                    </div>
                    <button onClick={startFbOAuth} style={{width:'100%',padding:'14px',background:'#1877F2',color:'white',border:'none',borderRadius:'10px',fontSize:'14px',fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:'10px',marginBottom:'8px'}}>
                      <span style={{fontSize:'18px'}}>👥</span> Facebook bilan kirish
                    </button>
                    <div style={{fontSize:'11px',color:'var(--text-muted)',textAlign:'center',lineHeight:'1.5'}}>
                      Tugma bosilsa Facebook login oynasi ochiladi. Sahifangizga admin ekanligingizni tasdiqlang.
                    </div>
                  </>)}

                  {/* Step 1: Waiting */}
                  {fbStep === 1 && (
                    <div style={{textAlign:'center',padding:'36px 20px'}}>
                      <div style={{fontSize:'36px',marginBottom:'14px',animation:'spin 1s linear infinite',display:'inline-block'}}>⏳</div>
                      <div style={{fontWeight:700,fontSize:'15px',marginBottom:'6px'}}>Facebook oynasi ochiq...</div>
                      <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'20px'}}>Yangi oynada Facebook ga kiring va ruxsat bering</div>
                      <button className="btn-outline" onClick={()=>setFbStep(0)}>← Bekor qilish</button>
                    </div>
                  )}

                  {/* Step 2: Page selection */}
                  {fbStep === 2 && (<>
                    <div style={{fontWeight:700,fontSize:'14px',marginBottom:'12px',display:'flex',alignItems:'center',gap:'8px'}}>
                      <span style={{background:'#1877F2',color:'white',borderRadius:'50%',width:'20px',height:'20px',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:800}}>2</span>
                      Qaysi sahifani ulash?
                    </div>
                    {fbPages.length === 0 && <div style={{padding:'20px',textAlign:'center',color:'var(--text-muted)',fontSize:'13px'}}>⚠️ Sahifalar topilmadi. Sahifangizning admin ekanligingizni tekshiring.</div>}
                    <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'14px'}}>
                      {fbPages.map(pg=>(
                        <button key={pg.id} onClick={()=>selectFbPage(pg)} style={{padding:'13px 16px',background:'var(--bg-base)',border:'2px solid var(--outline-variant)',borderRadius:'10px',cursor:'pointer',display:'flex',alignItems:'center',gap:'12px',textAlign:'left',transition:'all 0.15s'}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor='#1877F2';e.currentTarget.style.background='rgba(24,119,242,0.06)';}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--outline-variant)';e.currentTarget.style.background='var(--bg-base)';}}>
                          <div style={{width:'36px',height:'36px',background:'rgba(24,119,242,0.12)',borderRadius:'9px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',flexShrink:0}}>👥</div>
                          <div style={{flex:1}}><div style={{fontWeight:600,fontSize:'13px'}}>{pg.name}</div><div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'1px'}}>ID: {pg.id}</div></div>
                          <span style={{color:'#1877F2',fontSize:'12px',fontWeight:600}}>Tanlash →</span>
                        </button>
                      ))}
                    </div>
                    <button className="btn-outline" style={{width:'100%'}} onClick={()=>setFbStep(0)}>← Orqaga</button>
                  </>)}

                  {/* Step 3: Forms + field mapping */}
                  {fbStep === 3 && fbPage && (<>
                    {loadingF ? (
                      <div style={{textAlign:'center',padding:'24px',color:'var(--text-muted)'}}>📄 Formalar yuklanmoqda...</div>
                    ) : (<>
                      <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'12px'}}>
                        <span style={{background:'#1877F2',color:'white',borderRadius:'50%',width:'20px',height:'20px',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:800}}>3</span>
                        <div style={{fontWeight:700,fontSize:'13px'}}>📄 Sahifa: <span style={{color:'#1877F2'}}>{fbPage.name}</span></div>
                      </div>
                      <div style={{marginBottom:'14px'}}>
                        <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:'7px'}}>Forma tanlang</div>
                        <div style={{display:'flex',flexDirection:'column',gap:'5px'}}>
                          <button onClick={()=>setFbForm(null)} style={{padding:'9px 13px',background:fbForm===null?'rgba(24,119,242,0.1)':'var(--bg-base)',border:fbForm===null?'2px solid #1877F2':'1px solid var(--outline-variant)',borderRadius:'7px',cursor:'pointer',textAlign:'left',fontSize:'12px',fontWeight:fbForm===null?700:400,color:fbForm===null?'#1877F2':'var(--text-main)'}}>
                            📋 Barcha formalar (filtr yo'q)
                          </button>
                          {fbForms.map(f=>(
                            <button key={f.id} onClick={()=>setFbForm(f)} style={{padding:'9px 13px',background:fbForm?.id===f.id?'rgba(24,119,242,0.1)':'var(--bg-base)',border:fbForm?.id===f.id?'2px solid #1877F2':'1px solid var(--outline-variant)',borderRadius:'7px',cursor:'pointer',textAlign:'left',fontSize:'12px',fontWeight:fbForm?.id===f.id?700:400,color:fbForm?.id===f.id?'#1877F2':'var(--text-main)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                              <span>{f.name}</span>
                              {f.status&&<span style={{fontSize:'10px',color:'var(--text-muted)',padding:'2px 6px',background:'var(--surface-variant)',borderRadius:'4px'}}>{f.status}</span>}
                            </button>
                          ))}
                          {fbForms.length===0&&<div style={{fontSize:'12px',color:'var(--text-muted)',padding:'8px 12px',background:'rgba(245,158,11,0.07)',border:'1px solid rgba(245,158,11,0.2)',borderRadius:'7px'}}>⚠️ Bu sahifada lead formalar topilmadi. Barcha eventlar qabul qilinadi.</div>}
                        </div>
                      </div>
                      {/* Field Mapping */}
                      <div style={{marginBottom:'14px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'9px'}}>
                          <div style={{flex:1,height:'1px',background:'var(--outline-variant)'}}></div>
                          <span style={{fontSize:'10px',fontWeight:700,color:'#1877F2',textTransform:'uppercase',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>📋 Maydon Moslash</span>
                          <div style={{flex:1,height:'1px',background:'var(--outline-variant)'}}></div>
                        </div>
                        <div style={{background:'rgba(24,119,242,0.05)',border:'1px solid rgba(24,119,242,0.15)',borderRadius:'9px',overflow:'hidden'}}>
                          <div style={{display:'grid',gridTemplateColumns:'1fr 20px 1fr',padding:'7px 13px',background:'rgba(24,119,242,0.1)',borderBottom:'1px solid rgba(24,119,242,0.15)'}}>
                            <span style={{fontSize:'10px',fontWeight:700,color:'#1877F2',textTransform:'uppercase'}}>Facebook maydoni</span>
                            <span></span>
                            <span style={{fontSize:'10px',fontWeight:700,color:'#1877F2',textTransform:'uppercase'}}>CRM maydoni</span>
                          </div>
                          {FB_FIELDS.map((row,i)=>(
                            <div key={row.fb} style={{display:'grid',gridTemplateColumns:'1fr 20px 1fr',padding:'6px 13px',borderBottom:i<FB_FIELDS.length-1?'1px solid rgba(24,119,242,0.08)':'none',alignItems:'center'}}>
                              <div style={{fontSize:'11px',color:'var(--text-secondary)'}}>{row.lbl}</div>
                              <div style={{textAlign:'center',fontSize:'11px',color:'var(--text-muted)'}}>→</div>
                              <select value={fbFm[row.fb]||''} onChange={e=>setFbFm({...fbFm,[row.fb]:e.target.value})} style={{background:'var(--bg-surface)',border:'1px solid var(--outline-variant)',borderRadius:'5px',padding:'4px 7px',fontSize:'11px',color:'var(--text-main)',cursor:'pointer',outline:'none',width:'100%'}}>
                                {CRM_OPTS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{display:'flex',gap:'8px'}}>
                        <button className="btn-primary" style={{flex:1,padding:'11px'}} disabled={fbSaving} onClick={saveFb}>{fbSaving?'⏳ Ulanmoqda...':'🔌 Ulash'}</button>
                        <button className="btn-outline" style={{padding:'11px 15px'}} onClick={()=>setFbStep(2)}>← Sahifalar</button>
                      </div>
                    </>)}
                  </>)}
                </div>
              );
            };

            // ── Instagram OAuth multi-step flow ────────────────────
            const IgOAuthFlow = () => {
              const [igStep,     setIgStep]     = useState(0); // 0=list+btn, 1=waiting, 2=accounts, 3=type+save
              const [igAccounts, setIgAccounts] = useState([]);
              const [igAccount,  setIgAccount]  = useState(null);
              const [igConnType, setIgConnType] = useState('direct'); // 'direct' | 'comments'
              const [igSaving,   setIgSaving]   = useState(false);
              const connList = Array.isArray(configs.instagram) ? configs.instagram : (configs.instagram ? [configs.instagram] : []);

              useEffect(() => {
                const handler = (e) => {
                  if (e.data?.type === 'ig_oauth_success') { setIgAccounts(e.data.accounts||[]); setIgStep(2); }
                  else if (e.data?.type === 'ig_oauth_error') { flash('❌ Instagram: '+(e.data.error||'Xato')); setIgStep(0); }
                };
                window.addEventListener('message', handler);
                return () => window.removeEventListener('message', handler);
              }, []);

              const startIgOAuth = () => {
                const popup = window.open('/api/oauth/instagram/init', 'ig_oauth', 'width=600,height=700,left=200,top=100');
                if (!popup) { flash('❌ Popup bloklandi.'); return; }
                setIgStep(1);
              };

              const saveIg = async () => {
                if (!igAccount) return;
                setIgSaving(true);
                try {
                  const r = await fetch('/api/integrations', {method:'POST', headers:authH(), body:JSON.stringify({
                    platform:'instagram', page_id:igAccount.ig_id||igAccount.page_id,
                    access_token:igAccount.access_token,
                    extra_config:{account_name:igAccount.ig_username||igAccount.ig_name, page_name:igAccount.page_name, ig_id:igAccount.ig_id, connection_type:igConnType},
                  })});
                  const d = await r.json();
                  if (!r.ok) throw new Error(d.error||'Xato');
                  const newEntry = {id:d.id, account_name:igAccount.ig_username||igAccount.ig_name, page_name:igAccount.page_name, connection_type:igConnType, _connected_at:new Date().toISOString()};
                  const newList  = [...connList, newEntry];
                  const updated  = {...configs, instagram: newList};
                  setConfigs(updated); localStorage.setItem('mizon_integrations',JSON.stringify(updated));
                  flash('✅ @'+(igAccount.ig_username||igAccount.ig_name)+' ulandi'); setIgStep(0); setIgAccount(null);
                } catch(e) { flash('❌ '+e.message); }
                setIgSaving(false);
              };

              const disconnectIgAccount = async (item) => {
                if (!window.confirm(`"@${item.account_name||item.ig_id}" ni uzasizmi?`)) return;
                if (item.id) { try { await fetch(`/api/integrations/id/${item.id}`,{method:'DELETE',headers:authH()}); } catch {} }
                const newList = connList.filter(p=>p!==item);
                const updated = {...configs};
                if (newList.length > 0) updated.instagram = newList;
                else delete updated.instagram;
                setConfigs(updated); localStorage.setItem('mizon_integrations',JSON.stringify(updated));
                flash(newList.length?`🔌 "@${item.account_name}" uzildi`:'🔌 Instagram integratsiyasi uzildi');
              };

              return (
                <div style={{padding:'20px 22px'}}>
                  {/* Step 0 */}
                  {igStep === 0 && (<>
                    {connList.length > 0 && (
                      <div style={{marginBottom:'14px'}}>
                        <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:'8px'}}>Ulangan Instagram hisoblari ({connList.length})</div>
                        {connList.map((a,i)=>(
                          <div key={a.id||i} style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 13px',background:'rgba(228,64,95,0.07)',border:'1px solid rgba(228,64,95,0.25)',borderRadius:'8px',marginBottom:'6px'}}>
                            <div style={{flex:1}}>
                              <div style={{fontWeight:600,fontSize:'13px'}}>@{a.account_name||a.ig_id}</div>
                              {a.page_name&&<div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'1px'}}>📄 {a.page_name}</div>}
                              {a.connection_type&&<div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'1px'}}>{a.connection_type==='direct'?'💬 Direct xabarlar':'💭 Izohlar'}</div>}
                            </div>
                            <span style={{padding:'2px 8px',borderRadius:'20px',fontSize:'10px',fontWeight:700,background:'rgba(1,167,80,0.12)',color:'#01a750',border:'1px solid rgba(1,167,80,0.3)'}}>● Faol</span>
                            <button style={{padding:'4px 10px',fontSize:'11px',background:'none',border:'1px solid rgba(239,68,68,0.3)',color:'#ef4444',borderRadius:'6px',cursor:'pointer'}} onClick={()=>disconnectIgAccount(a)}>Uzish</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{background:'rgba(228,64,95,0.07)',border:'1px solid rgba(228,64,95,0.2)',borderRadius:'9px',padding:'10px 14px',marginBottom:'12px'}}>
                      <div style={{fontSize:'10px',fontWeight:700,color:'#E4405F',marginBottom:'5px',textTransform:'uppercase'}}>Webhook URL — Meta Developer → Webhooks → messages</div>
                      <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                        <code style={{flex:1,fontSize:'11px',color:'var(--text-main)',wordBreak:'break-all'}}>{origin}/api/webhook/meta</code>
                        <button onClick={()=>copyText(origin+'/api/webhook/meta','ig_wh')} style={{padding:'3px 9px',fontSize:'11px',fontWeight:700,background:copiedItem==='ig_wh'?'#01a750':'#E4405F',color:'white',border:'none',borderRadius:'5px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>{copiedItem==='ig_wh'?'✓':'📋 Nusxa'}</button>
                      </div>
                    </div>
                    <button onClick={startIgOAuth} style={{width:'100%',padding:'14px',background:'linear-gradient(135deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)',color:'white',border:'none',borderRadius:'10px',fontSize:'14px',fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:'10px',marginBottom:'8px'}}>
                      <span style={{fontSize:'18px'}}>📸</span> Instagram bilan kirish
                    </button>
                    <div style={{fontSize:'11px',color:'var(--text-muted)',textAlign:'center',lineHeight:'1.5'}}>
                      Instagram Business hisobingiz Facebook Sahifasiga ulangan bo'lishi kerak.
                    </div>
                  </>)}

                  {/* Step 1: Waiting */}
                  {igStep === 1 && (
                    <div style={{textAlign:'center',padding:'36px 20px'}}>
                      <div style={{fontSize:'36px',marginBottom:'14px'}}>⏳</div>
                      <div style={{fontWeight:700,fontSize:'15px',marginBottom:'6px'}}>Instagram oynasi ochiq...</div>
                      <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'20px'}}>Yangi oynada Facebook orqali kiring va ruxsat bering</div>
                      <button className="btn-outline" onClick={()=>setIgStep(0)}>← Bekor qilish</button>
                    </div>
                  )}

                  {/* Step 2: Account selection */}
                  {igStep === 2 && (<>
                    <div style={{fontWeight:700,fontSize:'14px',marginBottom:'12px',display:'flex',alignItems:'center',gap:'8px'}}>
                      <span style={{background:'#E4405F',color:'white',borderRadius:'50%',width:'20px',height:'20px',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:800}}>2</span>
                      Instagram Business hisobini tanlang
                    </div>
                    {igAccounts.length===0&&<div style={{padding:'20px',textAlign:'center',color:'var(--text-muted)',fontSize:'12px'}}>⚠️ Instagram Business hisobi topilmadi. Sahifangizga Instagram ulangan ekanligini tekshiring.</div>}
                    <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'14px'}}>
                      {igAccounts.map((a,i)=>(
                        <button key={a.ig_id||i} onClick={()=>{setIgAccount(a);setIgStep(3);}} style={{padding:'13px 16px',background:'var(--bg-base)',border:'2px solid var(--outline-variant)',borderRadius:'10px',cursor:'pointer',display:'flex',alignItems:'center',gap:'12px',textAlign:'left',transition:'all 0.15s'}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor='#E4405F';e.currentTarget.style.background='rgba(228,64,95,0.06)';}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--outline-variant)';e.currentTarget.style.background='var(--bg-base)';}}>
                          <div style={{width:'36px',height:'36px',background:'rgba(228,64,95,0.12)',borderRadius:'9px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'18px',flexShrink:0}}>📸</div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:600,fontSize:'13px'}}>@{a.ig_username||a.ig_name}</div>
                            <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'1px'}}>📄 {a.page_name} · ID: {a.ig_id}</div>
                          </div>
                          <span style={{color:'#E4405F',fontSize:'12px',fontWeight:600}}>Tanlash →</span>
                        </button>
                      ))}
                    </div>
                    <button className="btn-outline" style={{width:'100%'}} onClick={()=>setIgStep(0)}>← Orqaga</button>
                  </>)}

                  {/* Step 3: Connection type + save */}
                  {igStep === 3 && igAccount && (<>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'14px'}}>
                      <span style={{background:'#E4405F',color:'white',borderRadius:'50%',width:'20px',height:'20px',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:800}}>3</span>
                      <div style={{fontWeight:700,fontSize:'13px'}}>@{igAccount.ig_username||igAccount.ig_name}</div>
                    </div>
                    <div style={{marginBottom:'16px'}}>
                      <div style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',marginBottom:'8px'}}>Ulanish turini tanlang</div>
                      {[
                        {v:'direct',  label:'💬 Direct xabarlar', desc:'Instagram DM ga kelgan har bir xabar — yangi lead'},
                        {v:'comments',label:'💭 Izohlar (Comments)', desc:'Post izohlaridan lead yaratish'},
                      ].map(opt=>(
                        <button key={opt.v} onClick={()=>setIgConnType(opt.v)} style={{width:'100%',padding:'12px 16px',background:igConnType===opt.v?'rgba(228,64,95,0.1)':'var(--bg-base)',border:igConnType===opt.v?'2px solid #E4405F':'1px solid var(--outline-variant)',borderRadius:'9px',cursor:'pointer',textAlign:'left',marginBottom:'7px',transition:'all 0.15s'}}>
                          <div style={{fontWeight:600,fontSize:'13px',color:igConnType===opt.v?'#E4405F':'var(--text-main)'}}>{opt.label}</div>
                          <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'3px'}}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                    <div style={{display:'flex',gap:'8px'}}>
                      <button style={{flex:1,padding:'11px',background:'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366)',color:'white',border:'none',borderRadius:'9px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:igSaving?0.7:1}} disabled={igSaving} onClick={saveIg}>{igSaving?'⏳ Ulanmoqda...':'📸 Ulash'}</button>
                      <button className="btn-outline" style={{padding:'11px 15px'}} onClick={()=>setIgStep(2)}>← Hisob</button>
                    </div>
                  </>)}
                </div>
              );
            };

            // ── Google Sheets custom UI ─────────────────────────────
            const SheetsFlow = () => {
              const GS = '#0f9d58';
              const saved = configs.google_sheets || {};
              const [gsSaving,   setGsSaving]   = useState(false);
              const [testStatus, setTestStatus] = useState(null); // null|'loading'|'ok'|'err'

              const webhookUrl = `${origin}/api/webhook/sheets`;
              const slug = intgCompanySlug || '';

              // Apps Script — sarlavha nomidan avtomatik ustun aniqlash
              const script = [
                `// ╔════════════════════════════════════════════════════╗`,
                `// ║   Mizon CRM — Google Sheets (Meta Lead Ads)        ║`,
                `// ║   Extensions → Apps Script ga joylashtiring        ║`,
                `// ╚════════════════════════════════════════════════════╝`,
                ``,
                `const CRM_WEBHOOK  = '${webhookUrl}';`,
                `const COMPANY_SLUG = '${slug}';`,
                ``,
                `// Meta sheet sarlavhalaridan CRM maydonlariga avtomatik moslash`,
                `// Chap: sheetdagi ustun nomi | O'ng: CRM maydoni`,
                `const HEADER_MAP = {`,
                `  'full_name':    'name',`,
                `  'first_name':   'name',`,
                `  'last_name':    'name',`,
                `  'phone_number': 'phone',`,
                `  'phone':        'phone',`,
                `  'email':        'email',`,
                `  'city':         'region',`,
                `  'country':      'region',`,
                `  'comments':     'note',`,
                `  'message':      'note',`,
                `};`,
                ``,
                `// ─── Asosiy funksiya ──────────────────────────────────────`,
                `function syncNewLeads() {`,
                `  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();`,
                `  const lastRow = sheet.getLastRow();`,
                `  const props   = PropertiesService.getScriptProperties();`,
                `  const lastProcessed = parseInt(props.getProperty('mizon_last_row') || '1');`,
                `  if (lastRow <= lastProcessed) return;`,
                ``,
                `  // Sarlavha qatorini o'qib ustun indekslarini aniqlash`,
                `  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];`,
                `  const colIdx  = {};`,
                `  headers.forEach(function(h, i) {`,
                `    const field = HEADER_MAP[(h || '').toString().toLowerCase().trim()];`,
                `    if (field && colIdx[field] === undefined) colIdx[field] = i;`,
                `  });`,
                `  Logger.log('Aniqlangan ustunlar: ' + JSON.stringify(colIdx));`,
                ``,
                `  const startRow = lastProcessed + 1;`,
                `  const data = sheet.getRange(startRow, 1, lastRow - lastProcessed, sheet.getLastColumn()).getValues();`,
                ``,
                `  var processed = lastProcessed;`,
                `  for (var i = 0; i < data.length; i++) {`,
                `    var row = data[i];`,
                `    var firstName = colIdx['name'] !== undefined ? String(row[colIdx['name']] || '').trim() : '';`,
                `    var lastName  = colIdx['name_last'] !== undefined ? String(row[colIdx['name_last']] || '').trim() : '';`,
                `    var fullName  = [firstName, lastName].filter(Boolean).join(' ');`,
                `    var payload = {`,
                `      company_slug: COMPANY_SLUG,`,
                `      name:   fullName,`,
                `      phone:  colIdx['phone']  !== undefined ? String(row[colIdx['phone']]  || '').trim() : '',`,
                `      email:  colIdx['email']  !== undefined ? String(row[colIdx['email']]  || '').trim() : '',`,
                `      region: colIdx['region'] !== undefined ? String(row[colIdx['region']] || '').trim() : '',`,
                `      note:   colIdx['note']   !== undefined ? String(row[colIdx['note']]   || '').trim() : '',`,
                `      row_index: startRow + i,`,
                `    };`,
                `    if (!payload.name && !payload.phone) { processed++; continue; }`,
                `    try {`,
                `      var resp   = UrlFetchApp.fetch(CRM_WEBHOOK, {`,
                `        method: 'post', contentType: 'application/json',`,
                `        payload: JSON.stringify(payload), muteHttpExceptions: true,`,
                `      });`,
                `      var result = JSON.parse(resp.getContentText());`,
                `      Logger.log('Qator '+(startRow+i)+': '+(result.duplicate?'⚠️ Takrorlangan':'✅ id='+result.id));`,
                `    } catch(e) { Logger.log('Xato: '+e.message); }`,
                `    processed++;`,
                `    props.setProperty('mizon_last_row', String(processed));`,
                `  }`,
                `}`,
                ``,
                `// ─── Trigger o'rnatish — BIR MARTA ishga tushiring ───────`,
                `function createTrigger() {`,
                `  ScriptApp.getProjectTriggers()`,
                `    .filter(function(t){ return t.getHandlerFunction() === 'syncNewLeads'; })`,
                `    .forEach(function(t){ ScriptApp.deleteTrigger(t); });`,
                `  ScriptApp.newTrigger('syncNewLeads').timeBased().everyMinutes(5).create();`,
                `  Logger.log("✅ Trigger o'rnatildi — har 5 daqiqada sinxronlanadi");`,
                `}`,
              ].join('\n');

              const saveGs = async () => {
                setGsSaving(true);
                try {
                  await fetch('/api/integrations', {method:'POST', headers:authH(), body:JSON.stringify({
                    platform: 'google_sheets',
                    extra_config: { auto_detect: true },
                  })});
                  const updated = {...configs, google_sheets:{ auto_detect:true, _connected_at:new Date().toISOString() }};
                  setConfigs(updated); localStorage.setItem('mizon_integrations', JSON.stringify(updated));
                  flash('✅ Google Sheets sozlamalari saqlandi');
                  setActiveModal(null);
                } catch(e) { flash('❌ '+e.message); }
                setGsSaving(false);
              };

              const testConn = async () => {
                if (!slug) { flash('❌ Kompaniya slug topilmadi'); return; }
                setTestStatus('loading');
                try {
                  const r = await fetch('/api/webhook/sheets', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ company_slug:slug, name:'Test Mijoz (Google Sheets)', phone:'', note:'CRM dan yuborilgan sinov lead' }),
                  });
                  const d = await r.json();
                  setTestStatus((r.ok && d.success) ? 'ok' : 'err');
                } catch { setTestStatus('err'); }
                setTimeout(()=>setTestStatus(null), 3000);
              };

              return (
                <div style={{padding:'20px 22px'}}>
                  {/* Yo'riqnoma */}
                  <div style={{marginBottom:'16px'}}>
                    {[
                      {n:1, title:'Facebook Lead Ads → Google Sheets', desc:'Ads Manager → Lead Ads formasi → "Connect to Spreadsheet" — Meta tasdiq talab qilmaydi'},
                      {n:2, title:'Расширения → Apps Script → kodni paste qiling', desc:'Sheetni oching → yuqori menyu → Расширения (Extensions) → Apps Script → kodni joylashtiring → createTrigger() ni bir marta ▶️ Run qiling'},
                      {n:3, title:'Tayyor! Har 5 daqiqada avtomatik', desc:'Skript sarlavhadan ustunlarni o\'zi topadi — full_name, phone_number, email va boshqalar avtomatik aniqlanadi'},
                    ].map(s=>(
                      <div key={s.n} style={{display:'flex',gap:'11px',marginBottom:'11px',alignItems:'flex-start'}}>
                        <div style={{width:'22px',height:'22px',borderRadius:'50%',background:GS,color:'white',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',fontWeight:800,flexShrink:0}}>{s.n}</div>
                        <div>
                          <div style={{fontWeight:700,fontSize:'13px'}}>{s.title}</div>
                          <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'2px',lineHeight:'1.5'}}>{s.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Avtomatik aniqlanadigan sarlavhalar */}
                  <div style={{background:'rgba(15,157,88,0.06)',border:'1px solid rgba(15,157,88,0.2)',borderRadius:'10px',padding:'12px 14px',marginBottom:'14px'}}>
                    <div style={{fontSize:'10px',fontWeight:700,color:GS,textTransform:'uppercase',marginBottom:'8px',letterSpacing:'0.07em'}}>✅ Avtomatik aniqlanadigan sarlavhalar</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
                      {['full_name','first_name','phone_number','phone','email','city','country','comments','message'].map(h=>(
                        <span key={h} style={{fontSize:'10px',fontWeight:600,padding:'3px 8px',borderRadius:'20px',background:'rgba(15,157,88,0.12)',color:GS,border:'1px solid rgba(15,157,88,0.25)',fontFamily:'monospace'}}>{h}</span>
                      ))}
                    </div>
                    <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'7px'}}>Meta sheet sarlavhasi yuqoridagilardan biriga mos kelsa — avtomatik CRM ga o'tkaziladi</div>
                  </div>

                  {/* Apps Script kodi */}
                  <div style={{marginBottom:'14px'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'6px'}}>
                      <span style={{fontSize:'11px',fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase'}}>Google Apps Script kodi</span>
                      <button onClick={()=>copyText(script,'gs_script')} style={{padding:'4px 12px',fontSize:'11px',fontWeight:700,background:copiedItem==='gs_script'?'rgba(1,167,80,0.15)':'rgba(15,157,88,0.12)',color:copiedItem==='gs_script'?'#01a750':GS,border:`1px solid ${copiedItem==='gs_script'?'rgba(1,167,80,0.3)':'rgba(15,157,88,0.3)'}`,borderRadius:'6px',cursor:'pointer',whiteSpace:'nowrap'}}>
                        {copiedItem==='gs_script'?'✓ Nusxalandi':'📋 Kodni Nusxalash'}
                      </button>
                    </div>
                    <pre style={{background:'var(--bg-base)',border:'1px solid var(--outline-variant)',borderRadius:'8px',padding:'12px',fontSize:'10px',lineHeight:'1.65',color:'var(--text-secondary)',overflow:'auto',maxHeight:'220px',margin:0,fontFamily:'monospace',whiteSpace:'pre'}}>{script}</pre>
                  </div>

                  {/* Amallar */}
                  <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                    <button style={{flex:1,padding:'10px',background:GS,color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:700,cursor:'pointer',opacity:gsSaving?0.7:1}} disabled={gsSaving} onClick={saveGs}>
                      {gsSaving?'⏳ Saqlanmoqda...':(cfgIsOn('google_sheets')?'💾 Yangilash':'✅ Faollashtirish')}
                    </button>
                    <button onClick={testConn} disabled={testStatus==='loading'} style={{padding:'10px 14px',background:testStatus==='ok'?'rgba(1,167,80,0.12)':testStatus==='err'?'rgba(239,68,68,0.1)':'var(--surface-variant)',border:`1px solid ${testStatus==='ok'?'rgba(1,167,80,0.3)':testStatus==='err'?'rgba(239,68,68,0.3)':'var(--outline-variant)'}`,color:testStatus==='ok'?'#01a750':testStatus==='err'?'#ef4444':'var(--text-secondary)',borderRadius:'8px',cursor:'pointer',fontSize:'12px',fontWeight:600,whiteSpace:'nowrap'}}>
                      {testStatus==='loading'?'⏳ Test...':testStatus==='ok'?'✅ Ishlaydi':testStatus==='err'?'❌ Xato':'🧪 Test'}
                    </button>
                    {cfgIsOn('google_sheets') && (
                      <button style={{padding:'10px 12px',background:'none',border:'1px solid rgba(239,68,68,0.35)',color:'#ef4444',borderRadius:'8px',cursor:'pointer',fontSize:'12px',fontWeight:600}} onClick={()=>disconnectIntg('google_sheets')}>Uzish</button>
                    )}
                  </div>
                </div>
              );
            };

            // ── Modal wrapper ───────────────────────────────────────
            const isCustomUI = activeModal.key === 'facebook' || activeModal.key === 'instagram' || activeModal.key === 'google_sheets';
            const isFbIg = activeModal.key === 'facebook' || activeModal.key === 'instagram';
            return (
              <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}} onClick={e=>{if(e.target===e.currentTarget)setActiveModal(null);}}>
                <div style={{background:'var(--bg-surface)',borderRadius:'16px',width:'100%',maxWidth:isCustomUI?'520px':(activeModal.showMapping?'580px':'460px'),maxHeight:'92vh',overflow:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.4)'}}>

                  {/* Header */}
                  <div style={{padding:'18px 22px 14px',display:'flex',alignItems:'center',gap:'12px',borderBottom:'1px solid var(--outline-variant)',position:'sticky',top:0,background:'var(--bg-surface)',zIndex:1}}>
                    <div style={{width:'42px',height:'42px',background:activeModal.bg,borderRadius:'11px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'21px'}}>{activeModal.logo}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:'16px'}}>{activeModal.name}</div>
                      <div style={{fontSize:'11px',color:'var(--text-muted)'}}>
                        {activeModal.key==='google_sheets' ? 'Ustun moslash va Apps Script' : isFbIg ? 'OAuth orqali ulash' : 'Integratsiya sozlamalari'}
                      </div>
                    </div>
                    <button onClick={()=>setActiveModal(null)} style={{background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'var(--text-muted)',lineHeight:1,padding:'4px'}}>✕</button>
                  </div>

                  {/* Facebook OAuth */}
                  {activeModal.key === 'facebook' && <FbOAuthFlow />}

                  {/* Instagram OAuth */}
                  {activeModal.key === 'instagram' && <IgOAuthFlow />}

                  {/* Google Sheets */}
                  {activeModal.key === 'google_sheets' && <SheetsFlow />}

                  {/* Standard form modal (telegram, voip, webhook) */}
                  {!isCustomUI && (
                    <div style={{padding:'20px 22px'}}>
                      {activeModal.wh && (
                        <div style={{background:activeModal.bg,border:`1px solid ${activeModal.color}30`,borderRadius:'9px',padding:'11px 14px',marginBottom:'16px'}}>
                          <div style={{fontSize:'10px',fontWeight:700,color:activeModal.color,marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.07em'}}>{activeModal.wh.label}</div>
                          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                            <code style={{flex:1,fontSize:'11px',color:'var(--text-main)',wordBreak:'break-all',lineHeight:'1.5'}}>{activeModal.wh.url}</code>
                            <button onClick={()=>copyText(activeModal.wh.url,'modal_wh')} style={{padding:'4px 10px',fontSize:'11px',fontWeight:700,background:copiedItem==='modal_wh'?'#01a750':activeModal.color,color:'white',border:'none',borderRadius:'6px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0,transition:'background 0.15s'}}>
                              {copiedItem==='modal_wh'?'✓ Nusxalandi':'📋 Nusxa'}
                            </button>
                          </div>
                        </div>
                      )}
                      {activeModal.verifyToken && (
                        <div style={{background:'var(--bg-base)',border:'1px solid var(--outline-variant)',borderRadius:'8px',padding:'10px 14px',marginBottom:'14px'}}>
                          <div style={{fontSize:'10px',fontWeight:700,color:'var(--text-muted)',marginBottom:'5px',textTransform:'uppercase',letterSpacing:'0.07em'}}>Verify Token — Meta Developer Dashboard → Webhooks sahifasiga kiriting</div>
                          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                            <code style={{flex:1,fontSize:'12px',color:'var(--primary)',fontWeight:600}}>{activeModal.verifyToken}</code>
                            <button onClick={()=>copyText(activeModal.verifyToken,'vtok')} style={{padding:'3px 9px',fontSize:'11px',background:'var(--surface-variant)',border:'1px solid var(--outline-variant)',borderRadius:'5px',cursor:'pointer',color:copiedItem==='vtok'?'#01a750':'var(--text-muted)',fontWeight:700}}>
                              {copiedItem==='vtok'?'✓':'📋'}
                            </button>
                          </div>
                        </div>
                      )}
                      {activeModal.fields.map(f => (
                        <div key={f.k} style={{marginBottom:'12px'}}>
                          <span className="label-sm">{f.label}</span>
                          <input className="input-base" type={f.t} placeholder={f.ph} value={formData[f.k]||''} onChange={e=>setFormData({...formData,[f.k]:e.target.value})} style={{marginBottom:0}}/>
                        </div>
                      ))}
                      <div style={{display:'flex',gap:'9px',marginTop:'20px'}}>
                        <button className="btn-primary" style={{flex:1,padding:'10px'}} disabled={saving} onClick={()=>saveConfig(activeModal.key, formData)}>
                          {saving ? '⏳ Saqlanmoqda...' : (cfgIsOn(activeModal.key)?'💾 Yangilash':'🔌 Ulash')}
                        </button>
                        {cfgIsOn(activeModal.key) && (
                          <button style={{padding:'10px 14px',background:'none',border:'1px solid rgba(239,68,68,0.35)',color:'#ef4444',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:600}} onClick={()=>disconnectIntg(activeModal.key)}>Uzish</button>
                        )}
                        <button className="btn-outline" style={{padding:'10px 14px'}} onClick={()=>setActiveModal(null)}>Bekor</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── API KEYS MODAL ─────────────────────────────────── */}
          {activeModal === 'apikeys' && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}} onClick={e=>{if(e.target===e.currentTarget)setActiveModal(null);}}>
              <div style={{background:'var(--bg-surface)',borderRadius:'16px',width:'100%',maxWidth:'500px',maxHeight:'88vh',overflow:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.4)'}}>
                <div style={{padding:'20px 22px 16px',display:'flex',alignItems:'center',gap:'12px',borderBottom:'1px solid var(--outline-variant)'}}>
                  <div style={{width:'42px',height:'42px',background:'rgba(245,158,11,0.12)',borderRadius:'11px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'21px'}}>🔑</div>
                  <div style={{flex:1}}><div style={{fontWeight:700,fontSize:'16px'}}>API Kalitlar</div><div style={{fontSize:'11px',color:'var(--text-muted)'}}>Tashqi tizimlar uchun kirish kalitlari</div></div>
                  <button onClick={()=>setActiveModal(null)} style={{background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'var(--text-muted)',lineHeight:1}}>✕</button>
                </div>
                <div style={{padding:'20px 22px'}}>
                  <div style={{background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.2)',borderRadius:'8px',padding:'12px 14px',marginBottom:'16px',fontSize:'12px',color:'var(--text-secondary)',lineHeight:'1.65'}}>
                    Kalit header orqali yuboring: <code style={{background:'var(--surface-variant)',padding:'2px 7px',borderRadius:'4px',fontSize:'11px'}}>Authorization: Bearer {'<'}token{'>'}</code><br/>
                    Endpoint: <code style={{background:'var(--surface-variant)',padding:'2px 7px',borderRadius:'4px',fontSize:'11px'}}>POST {origin}/api/leads</code>
                  </div>
                  <button className="btn-primary" onClick={genApiKey} style={{width:'100%',padding:'10px',marginBottom:'14px'}}>+ Yangi API Kalit Yaratish</button>
                  {apiKeys.length === 0 && <div style={{textAlign:'center',padding:'28px',color:'var(--text-muted)',fontSize:'13px'}}>Hali kalit yaratilmagan</div>}
                  <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                    {apiKeys.map(k => (
                      <div key={k.id} style={{padding:'10px 13px',background:'rgba(245,158,11,0.07)',border:'1px solid rgba(245,158,11,0.2)',borderRadius:'8px',display:'flex',alignItems:'center',gap:'10px'}}>
                        <code style={{flex:1,fontSize:'11px',color:'var(--text-main)',wordBreak:'break-all'}}>{k.token}</code>
                        <button onClick={()=>copyText(k.token,k.id)} style={{padding:'4px 9px',fontSize:'11px',fontWeight:700,background:copiedItem===k.id?'rgba(1,167,80,0.15)':'rgba(245,158,11,0.12)',color:copiedItem===k.id?'#01a750':'#f59e0b',border:`1px solid ${copiedItem===k.id?'rgba(1,167,80,0.3)':'rgba(245,158,11,0.3)'}`,borderRadius:'5px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>
                          {copiedItem===k.id?'✓':'📋'}
                        </button>
                        <button onClick={()=>delApiKey(k.id)} style={{padding:'4px 8px',fontSize:'12px',background:'none',border:'1px solid rgba(239,68,68,0.3)',color:'#ef4444',borderRadius:'5px',cursor:'pointer'}}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── WEB FORM LINK MODAL ────────────────────────────── */}
          {activeModal === 'webformlink' && (() => {
            // ── Local state for the full webform editor ───────────────────────
            const [wfPipe,    setWfPipe]    = useState(intgPipelines[0]?.id || '');
            const [wfLink,    setWfLink]    = useState('');
            const [wfCopied,  setWfCopied]  = useState(false);
            const [wfSaving,  setWfSaving]  = useState(false);
            const [wfSaved,   setWfSaved]   = useState(false);
            // Local copies so changes are only applied on explicit save
            const [localTitle,    setLocalTitle]    = useState(formSettings?.form_title    || '');
            const [localSubtitle, setLocalSubtitle] = useState(formSettings?.form_subtitle || '');
            const [localFields,   setLocalFields]   = useState(formFields ? [...formFields] : []);
            const [activeWfTab,   setActiveWfTab]   = useState('design'); // 'design' | 'fields' | 'link'

            const generateLink = () => {
              if (!wfPipe) return alert('Avval quvurni tanlang!');
              const base = window.location.origin + window.location.pathname;
              const slugParam = intgCompanySlug && !window.location.hostname.endsWith('.mizon-crm.uz') ? `&company=${intgCompanySlug}` : '';
              const link = `${base}?leadForm=true&pipe=${wfPipe}${slugParam}`;
              setWfLink(link);
              navigator.clipboard?.writeText(link).catch(()=>{});
              setWfCopied(true); setTimeout(()=>setWfCopied(false), 2500);
            };

            const saveAll = async () => {
              setWfSaving(true);
              // 1. Sarlavhani API ga saqlash
              const t = localStorage.getItem('mizon_token');
              if (t) {
                try {
                  await fetch('/api/company/settings', {
                    method:'PUT',
                    headers:{'Content-Type':'application/json','Authorization':'Bearer '+t},
                    body:JSON.stringify({form_title:localTitle, form_subtitle:localSubtitle})
                  });
                  if (setFormSettings) setFormSettings({form_title:localTitle, form_subtitle:localSubtitle});
                } catch(e) { console.error('Saqlashda xato:', e); }
              }
              // 2. Forma savollarini localStorage ga saqlash
              if (setFormFields) setFormFields(localFields);
              localStorage.setItem('mizon_formFields', JSON.stringify(localFields));
              setWfSaving(false); setWfSaved(true);
              setTimeout(()=>setWfSaved(false), 2500);
            };

            // Tab style helper
            const tabSt = (id) => ({
              padding:'8px 18px', fontSize:'12px', fontWeight:600, cursor:'pointer', borderRadius:'8px',
              background: activeWfTab===id ? 'var(--primary-container)' : 'transparent',
              color: activeWfTab===id ? '#fff' : 'var(--text-muted)',
              border: 'none', transition:'all 0.15s'
            });

            return (
              <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',overflowY:'auto'}}
                   onClick={e=>{if(e.target===e.currentTarget)setActiveModal(null);}}>
                <div style={{background:'var(--bg-surface)',borderRadius:'16px',width:'100%',maxWidth:'680px',boxShadow:'0 24px 64px rgba(0,0,0,0.45)',display:'flex',flexDirection:'column',maxHeight:'90vh'}}>

                  {/* Header */}
                  <div style={{padding:'18px 22px 14px',display:'flex',alignItems:'center',gap:'12px',borderBottom:'1px solid var(--outline-variant)',flexShrink:0}}>
                    <div style={{width:'42px',height:'42px',background:'linear-gradient(135deg,rgba(90,223,129,0.15),rgba(139,92,246,0.15))',borderRadius:'11px',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'21px'}}>🔗</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:'16px'}}>Tashqi Havola & Forma Sozlamalari</div>
                      <div style={{fontSize:'11px',color:'var(--text-muted)'}}>Mijoz ro'yxatdan o'tish formasi — dizayn, savollar va URL</div>
                    </div>
                    <button onClick={()=>setActiveModal(null)} style={{background:'none',border:'none',fontSize:'22px',cursor:'pointer',color:'var(--text-muted)',lineHeight:1,padding:'4px'}}>✕</button>
                  </div>

                  {/* Tab bar */}
                  <div style={{display:'flex',gap:'4px',padding:'12px 22px 0',borderBottom:'1px solid var(--outline-variant)',flexShrink:0}}>
                    {[['design','🎨 Dizayn'],['fields','📋 Forma Savollari'],['link','🔗 Havola Yaratish']].map(([id,label])=>(
                      <button key={id} style={tabSt(id)} onClick={()=>setActiveWfTab(id)}>{label}</button>
                    ))}
                  </div>

                  {/* Body — scrollable */}
                  <div style={{padding:'20px 22px',overflowY:'auto',flex:1}}>

                    {/* ── TAB 1: Dizayn (sarlavha & ko'rinish) ── */}
                    {activeWfTab === 'design' && (
                      <div>
                        <p style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'18px',lineHeight:'1.7'}}>
                          Mijoz formangizning sarlavhasi va tavsifini sozlang. Bu ma'lumotlar formaning yuqori qismida ko'rsatiladi.
                        </p>

                        <div style={{padding:'16px',background:'var(--bg-base)',border:'1px solid var(--border-light)',borderRadius:'10px',marginBottom:'16px'}}>
                          <div style={{fontWeight:600,fontSize:'13px',marginBottom:'12px',display:'flex',alignItems:'center',gap:'6px'}}>
                            <span className="material-symbols-outlined" style={{fontSize:'16px'}}>title</span> Forma Sarlavhasi
                          </div>
                          <span className="label-sm">Asosiy sarlavha (bo'sh bo'lsa kompaniya nomi ishlatiladi)</span>
                          <input className="input-base" placeholder="Masalan: Bepul konsultatsiya olish" value={localTitle} onChange={e=>setLocalTitle(e.target.value)} />
                          <span className="label-sm">Tavsif matni</span>
                          <input className="input-base" placeholder="Masalan: Ma'lumotlaringizni qoldiring, 1 soat ichida aloqaga chiqamiz." value={localSubtitle} onChange={e=>setLocalSubtitle(e.target.value)} />
                        </div>

                        {/* Preview */}
                        <div style={{padding:'20px',background:'linear-gradient(135deg,rgba(99,102,241,0.07),rgba(139,92,246,0.07))',border:'1px solid rgba(139,92,246,0.2)',borderRadius:'10px',textAlign:'center',marginBottom:'18px'}}>
                          <div style={{fontSize:'11px',color:'var(--text-muted)',marginBottom:'8px',textTransform:'uppercase',letterSpacing:'0.08em'}}>Ko'rinish oldindan namunasi</div>
                          <div style={{fontWeight:700,fontSize:'18px',marginBottom:'6px'}}>{localTitle || '(Kompaniya nomi)'}</div>
                          <div style={{fontSize:'13px',color:'var(--text-muted)'}}>{localSubtitle || "Ma'lumotlaringizni qoldiring, tez orada aloqaga chiqamiz."}</div>
                        </div>
                      </div>
                    )}

                    {/* ── TAB 2: Forma Savollari ── */}
                    {activeWfTab === 'fields' && (
                      <div>
                        <p style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'14px',lineHeight:'1.7'}}>
                          Formada foydalanuvchilarga ko'rsatiladigan savollarni sozlang. <b>Ism</b> va <b>Telefon</b> maydonlari doim mavjud bo'ladi.
                        </p>

                        {/* Tizimiy (o'chirib bo'lmaydigan) maydonlar */}
                        <div style={{marginBottom:'10px'}}>
                          {[{label:"Ism (majburiy)",ph:"Ismingizni kiriting"},{label:"Telefon (majburiy)",ph:"+998 90 000 00 00"}].map((f,i)=>(
                            <div key={i} style={{display:'flex',gap:'8px',alignItems:'center',padding:'10px',background:'rgba(99,102,241,0.05)',border:'1px solid rgba(99,102,241,0.15)',borderRadius:'8px',marginBottom:'6px',opacity:0.75}}>
                              <span style={{color:'var(--text-muted)',fontSize:'12px',width:'20px'}}>{i+1}</span>
                              <input className="input-base" style={{marginBottom:0,flex:2}} value={f.label} disabled />
                              <span style={{fontSize:'11px',color:'var(--text-muted)',background:'var(--surface-variant)',padding:'3px 8px',borderRadius:'4px',whiteSpace:'nowrap'}}>Tizimiy</span>
                            </div>
                          ))}
                        </div>

                        {/* Dinamik maydonlar */}
                        <div style={{display:'flex',flexDirection:'column',gap:'6px',marginBottom:'14px'}}>
                          {localFields.map((f,idx)=>(
                            <div key={f.id} style={{display:'flex',gap:'8px',alignItems:'center',padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border-light)',borderRadius:'8px'}}>
                              <span style={{color:'var(--text-muted)',fontSize:'12px',width:'20px'}}>{idx+3}</span>
                              <input className="input-base" style={{marginBottom:0,flex:2}} placeholder="Savol nomi" value={f.label}
                                onChange={e=>setLocalFields(localFields.map(x=>x.id===f.id?{...x,label:e.target.value}:x))} />
                              <input className="input-base" style={{marginBottom:0,flex:1}} placeholder="key" value={f.key}
                                onChange={e=>setLocalFields(localFields.map(x=>x.id===f.id?{...x,key:e.target.value}:x))} />
                              <select className="input-base" style={{marginBottom:0,width:'90px'}} value={f.type}
                                onChange={e=>setLocalFields(localFields.map(x=>x.id===f.id?{...x,type:e.target.value}:x))}>
                                <option value="text">Matn</option>
                                <option value="tel">Telefon</option>
                                <option value="email">Email</option>
                                <option value="number">Raqam</option>
                              </select>
                              <label style={{fontSize:'11px',color:'var(--text-muted)',display:'flex',alignItems:'center',gap:'4px',cursor:'pointer',whiteSpace:'nowrap'}}>
                                <input type="checkbox" checked={f.required} onChange={e=>setLocalFields(localFields.map(x=>x.id===f.id?{...x,required:e.target.checked}:x))}/> Majburiy
                              </label>
                              <button className="btn-danger" style={{padding:'4px 8px'}} onClick={()=>setLocalFields(localFields.filter(x=>x.id!==f.id))}>✕</button>
                            </div>
                          ))}
                        </div>
                        <button className="btn-outline" style={{width:'100%'}}
                          onClick={()=>setLocalFields([...localFields,{id:'f_'+Date.now(),label:'',key:'field_'+Date.now(),type:'text',required:false,placeholder:''}])}>
                          + Yangi savol qo'shish
                        </button>
                        {localFields.length === 0 && (
                          <div style={{padding:'16px',textAlign:'center',color:'var(--text-muted)',fontSize:'12px',marginTop:'8px'}}>
                            Qo'shimcha savol yo'q. Yuqoridagi tugmani bosib savol qo'shing.
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── TAB 3: Havola Yaratish ── */}
                    {activeWfTab === 'link' && (
                      <div>
                        <p style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'16px',lineHeight:'1.7'}}>
                          Havolani ijtimoiy tarmoqlarda, saytda yoki WhatsApp da ulashing. Mijoz bosib kirsa, forma ochiladi va lead avtomatik CRM ga tushadi.
                        </p>
                        <span className="label-sm">Quvurni tanlang</span>
                        <select className="input-base" value={wfPipe} onChange={e=>setWfPipe(e.target.value)}>
                          <option value="" disabled>Quvurni tanlang...</option>
                          {intgPipelines.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        {intgPipelines.length === 0 && (
                          <div style={{fontSize:'12px',color:'var(--warning)',marginBottom:'10px',padding:'10px',background:'rgba(245,158,11,0.08)',borderRadius:'6px'}}>
                            ⚠️ Quvur topilmadi. Avval Sozlamalar → Varonkalar bo'limida quvur yarating.
                          </div>
                        )}
                        <button className="btn-primary" style={{width:'100%',marginBottom:'14px'}} onClick={generateLink} disabled={!wfPipe}>
                          🔗 Havola Yaratish va Nusxalash
                        </button>
                        {wfLink && (
                          <div style={{display:'flex',gap:'8px',alignItems:'center',padding:'12px 14px',background:'var(--bg-base)',border:`1px solid ${wfCopied?'rgba(1,167,80,0.4)':'var(--border-light)'}`,borderRadius:'8px',transition:'border-color 0.3s',marginBottom:'12px'}}>
                            <code style={{flex:1,fontSize:'11px',color:'var(--success)',wordBreak:'break-all'}}>{wfLink}</code>
                            <span style={{fontSize:'11px',color:'var(--success)',fontWeight:700,whiteSpace:'nowrap',minWidth:'80px',textAlign:'right'}}>{wfCopied?'✓ Nusxalandi!':''}</span>
                          </div>
                        )}
                        <div style={{padding:'12px',background:'rgba(99,102,241,0.07)',border:'1px solid rgba(99,102,241,0.15)',borderRadius:'8px',fontSize:'12px',color:'var(--text-muted)',lineHeight:'1.7'}}>
                          💡 Forma dizayni va sarlavhasini <b>🎨 Dizayn</b> tabida, savollarni <b>📋 Forma Savollari</b> tabida o'zgartiring. O'zgarishlar "<b>Saqlash</b>" tugmasini bosganingizda kuchga kiradi.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div style={{padding:'14px 22px',borderTop:'1px solid var(--outline-variant)',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                    <button className="btn-outline" onClick={()=>setActiveModal(null)}>Yopish</button>
                    <button className="btn-primary" onClick={saveAll} disabled={wfSaving}>
                      {wfSaving ? 'Saqlanmoqda...' : wfSaved ? '✓ Saqlandi!' : '💾 Saqlash'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      );
    };

    // ===== CALL CENTER MODULE (fully functional) =====
    const CallCenterModule = ({ leads, setLeads, globalCallLimit, setSelectedLeadId, syncLeadToAPI, addNotif, voipConfigured }) => {
      const [filterOp,  setFilterOp]  = useState('all');
      const [filterSt,  setFilterSt]  = useState('all');
      const [filterDir, setFilterDir] = useState('all'); // 'all' | 'in' | 'out'
      const [showAdd,   setShowAdd]   = useState(false);
      const [selLead,   setSelLead]   = useState('');
      const [callNote,  setCallNote]  = useState('');
      const [drillDown, setDrillDown] = useState(null);

      // chatLogs ichidan barcha qo'ng'iroq yozuvlarini chiqarish
      const allCalls = [];
      leads.forEach(lead => {
        (lead.chatLogs || []).forEach(log => {
          if (!log.text) return;
          const isCallEntry = log.type === 'call'
            || log.text.includes('📞')
            || log.text.includes('⛔');
          if (!isCallEntry) return;
          const isIn      = log.direction === 'in' || log.text.includes('Kiruvchi');
          const isMissed  = log.text.includes('⛔')
            || /missed|no.?answer/i.test(log.text);
          allCalls.push({
            leadId:    String(lead.id),
            leadName:  lead.name,
            phone:     lead.phone,
            operator:  lead.owner,
            date:      log.date,
            note:      log.text,
            direction: isIn ? 'in' : 'out',
            status:    isMissed ? 'missed' : 'answered',
            recordUrl: log.record_url || null,
          });
        });
      });
      allCalls.sort((a, b) => new Date(b.date) - new Date(a.date));

      const filtered = allCalls.filter(c => {
        if (filterOp  !== 'all' && c.operator  !== filterOp)  return false;
        if (filterSt  !== 'all' && c.status    !== filterSt)  return false;
        if (filterDir !== 'all' && c.direction !== filterDir) return false;
        return true;
      });

      const totalAttempts = leads.reduce((s, l) => s + (l.actualCallAttempts || 0), 0);
      const answered = allCalls.filter(c => c.status === 'answered').length;
      const missed = allCalls.filter(c => c.status === 'missed').length;
      const activeLeadsCount = leads.filter(l => l.actualCallAttempts > 0).length;
      const operatorNames = [...new Set(leads.map(l => l.owner))];

      // Drill-down items for "Faol mijozlar" card
      const activeCallLeads = leads.filter(l => l.actualCallAttempts > 0).map(l => {
        const lastCallLog = [...l.chatLogs].reverse().find(lg => lg.text && (lg.text.includes('📞') || lg.text.includes('⛔')));
        return {
          leadId: String(l.id), leadName: l.name, phone: l.phone, operator: l.owner,
          date: lastCallLog?.date || l.chatLogs[0]?.date || '',
          note: `${l.actualCallAttempts} ta urinish · ${l.status}`,
          status: l.status === 'LOST' ? 'missed' : 'answered'
        };
      });

      const logCall = () => {
        if (!selLead) return alert("Mijozni tanlang!");
        const lead = leads.find(l => String(l.id) === selLead);
        if (!lead) return;
        const attempts = (lead.actualCallAttempts || 0) + 1;
        const isLost   = attempts >= globalCallLimit;
        const logText  = isLost
          ? `⛔ Qo'ng'iroq limiti tugadi (${globalCallLimit} urinish) — mijoz LOST ga o'tdi`
          : `📞 Chiquvchi qo'ng'iroq: ${lead.phone || '—'}${callNote ? ' — ' + callNote : ''}`;
        const updatedLead = {
          ...lead,
          actualCallAttempts: attempts,
          status:   isLost ? 'LOST' : lead.status,
          chatLogs: [...lead.chatLogs, {
            type: 'call', date: new Date().toISOString(),
            text: logText, direction: 'out',
          }],
        };
        setLeads(prev => prev.map(l => String(l.id) === selLead ? updatedLead : l));
        // API ga saqlash
        syncLeadToAPI(updatedLead);
        // Bildirishnoma
        if (isLost) {
          addNotif('call_limit', "📵 Qo'ng'iroq limiti tugadi",
            `${lead.name} — ${globalCallLimit} ta urinishdan keyin LOST`, lead.id);
        } else {
          addNotif('call_logged', "📞 Qo'ng'iroq qayd etildi",
            `${lead.name}${callNote ? ' — ' + callNote : ''}`, lead.id);
        }
        setSelLead(''); setCallNote(''); setShowAdd(false);
      };

      return (
        <div>
          <div className="mod-header">
            <div>
              <div className="mod-title">Call Center</div>
              <div className="mod-sub">Qo'ng'iroqlar jurnali va real-time statistika</div>
            </div>
            <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}>
              <span className="material-symbols-outlined" style={{fontSize:'16px',lineHeight:1,flexShrink:0}}>add_call</span> Qo'ng'iroq qayd etish
            </button>
          </div>

          {showAdd && (
            <div className="card" style={{marginBottom:'16px', background:'rgba(1,167,80,0.04)', border:'1px solid rgba(1,167,80,0.25)'}}>
              <div style={{fontWeight:600, fontSize:'14px', marginBottom:'14px', display:'flex', alignItems:'center', gap:'8px'}}>
                <span className="material-symbols-outlined" style={{fontSize:'18px', color:'var(--primary)'}}>call</span>
                Yangi qo'ng'iroqni qayd etish
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:'10px', alignItems:'end'}}>
                <div>
                  <span className="label-sm">Mijoz</span>
                  <select className="input-base" style={{marginBottom:0}} value={selLead} onChange={e=>setSelLead(e.target.value)}>
                    <option value="">— Mijozni tanlang —</option>
                    {leads.filter(l=>!['LOST','WON'].includes(l.status)).map(l => (
                      <option key={l.id} value={String(l.id)}>{l.name} ({l.phone}) · {l.actualCallAttempts}/{globalCallLimit}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="label-sm">Izoh (ixtiyoriy)</span>
                  <input className="input-base" style={{marginBottom:0}} placeholder="Shartnoma haqida gaplashildi..." value={callNote} onChange={e=>setCallNote(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') logCall(); }} />
                </div>
                <div style={{display:'flex', gap:'8px', paddingBottom:'1px'}}>
                  <button className="btn-primary" onClick={logCall}>Qayd etish</button>
                  <button className="btn-outline" onClick={()=>setShowAdd(false)}>✕</button>
                </div>
              </div>
            </div>
          )}

          <div className="stat-mini-grid">
            {[
              {label:"Jami urinishlar", val:totalAttempts, color:'var(--text-main)',
                onClick: () => setDrillDown({ title:"Jami qo'ng'iroqlar ro'yxati", items: allCalls })},
              {label:"Javob berildi", val:answered, color:'#01a750',
                onClick: () => setDrillDown({ title:"Javob berilgan qo'ng'iroqlar", items: allCalls.filter(c => c.status === 'answered') })},
              {label:"O'tkazib yuborildi", val:missed, color:'#ef4444',
                onClick: () => setDrillDown({ title:"O'tkazib yuborilgan qo'ng'iroqlar", items: allCalls.filter(c => c.status === 'missed') })},
              {label:"Faol mijozlar", val:activeLeadsCount, color:'#3b82f6',
                onClick: () => setDrillDown({ title:"Qo'ng'iroq qilingan mijozlar", items: activeCallLeads })},
            ].map((m, i) => (
              <div key={i} className="stat-mini clickable" onClick={m.onClick} title="Ro'yxatni ko'rish uchun bosing">
                <div className="stat-mini-label">{m.label}</div>
                <div className="stat-mini-value" style={{color:m.color}}>{m.val}</div>
              </div>
            ))}
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:'14px', marginBottom:'14px'}}>
            <div className="card">
              <div style={{fontWeight:600, fontSize:'14px', marginBottom:'14px'}}>Operatorlar samaradorligi</div>
              {operatorNames.map(op => {
                const opLeads = leads.filter(l => l.owner === op);
                const opCalls = opLeads.reduce((s, l) => s + (l.actualCallAttempts||0), 0);
                const opWon = opLeads.filter(l => l.status==='WON').length;
                const opLost = opLeads.filter(l => l.status==='LOST').length;
                const maxCalls = Math.max(1, ...operatorNames.map(o => leads.filter(l=>l.owner===o).reduce((s,l)=>s+(l.actualCallAttempts||0),0)));
                return (
                  <div key={op} style={{padding:'12px', background:'var(--bg-base)', borderRadius:'8px', border:'1px solid var(--border-light)', marginBottom:'8px'}}>
                    <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px'}}>
                      <div className="avatar" style={{width:'32px', height:'32px', fontSize:'12px'}}>{op[0].toUpperCase()}</div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:600, fontSize:'13px'}}>{op}</div>
                        <div style={{fontSize:'11px', color:'var(--text-muted)'}}>{opLeads.length} ta mijoz</div>
                      </div>
                      <div style={{display:'flex', gap:'10px', fontSize:'12px'}}>
                        <span style={{color:'#01a750', fontWeight:700}}>{opWon} ✓</span>
                        <span style={{color:'#ef4444', fontWeight:700}}>{opLost} ✗</span>
                        <span style={{color:'var(--text-muted)'}}>{opCalls} 📞</span>
                      </div>
                    </div>
                    <div className="chart-bar-track" style={{height:'5px'}}>
                      <div className="chart-bar-fill" style={{width:(opCalls/maxCalls*100)+'%', background:'var(--primary-container)'}}></div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card" style={{display:'flex', flexDirection:'column', gap:'10px'}}>
              <div style={{fontWeight:600, fontSize:'14px'}}>VoIP Tizim</div>
              <div style={{flex:1, padding:'16px', background:'var(--bg-hover)', borderRadius:'10px',
                border:`1px solid ${voipConfigured ? 'rgba(1,167,80,0.35)' : 'rgba(239,68,68,0.25)'}`,
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'10px', textAlign:'center'}}>
                <div style={{width:'56px', height:'56px', borderRadius:'50%',
                  background: voipConfigured ? 'rgba(1,167,80,0.1)' : 'rgba(239,68,68,0.08)',
                  border:`2px solid ${voipConfigured ? 'rgba(1,167,80,0.4)' : 'rgba(239,68,68,0.3)'}`,
                  display:'flex', alignItems:'center', justifyContent:'center'}}>
                  <span className="material-symbols-outlined" style={{fontSize:'26px', color: voipConfigured ? '#01a750' : '#ef4444'}}>
                    {voipConfigured ? 'call' : 'call_end'}
                  </span>
                </div>
                <div>
                  <div style={{fontSize:'13px', fontWeight:700, color: voipConfigured ? '#01a750' : '#ef4444'}}>
                    {voipConfigured ? 'Moizvonki Faol' : 'VoIP Ulangan emas'}
                  </div>
                  <div style={{fontSize:'11px', color:'var(--text-muted)', marginTop:'4px'}}>
                    {voipConfigured
                      ? "Kiruvchi / chiquvchi qo'ng'iroqlar faol"
                      : "Integratsiyalar bo'limidan sozlang"}
                  </div>
                </div>
                <code style={{fontSize:'10px', color:'var(--text-muted)', background:'var(--surface-variant)', padding:'4px 10px', borderRadius:'5px', display:'block', width:'100%'}}>POST /api/webhook/moizvonki</code>
              </div>
              <div style={{padding:'12px', background:'var(--bg-hover)', border:'1px solid var(--border-light)', borderRadius:'8px'}}>
                <div style={{fontSize:'10px', color:'var(--text-muted)', marginBottom:'8px', textTransform:'uppercase', fontWeight:700, letterSpacing:'0.06em'}}>Umumiy ko'rsatkichlar</div>
                {[
                  {label:"Jami qo'ng'iroqlar", val:totalAttempts},
                  {label:"Javob %", val: totalAttempts ? Math.round(answered/totalAttempts*100)+'%' : '0%'},
                  {label:"Konversiya", val: leads.length ? Math.round(leads.filter(l=>l.status==='WON').length/leads.length*100)+'%' : '0%'},
                ].map((s,i) => (
                  <div key={i} style={{display:'flex', justifyContent:'space-between', marginBottom:'5px'}}>
                    <span style={{fontSize:'12px', color:'var(--text-secondary)'}}>{s.label}</span>
                    <span style={{fontWeight:700, color:'var(--primary)'}}>{s.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card" style={{padding:0, overflow:'hidden'}}>
            <div style={{padding:'14px 20px', borderBottom:'1px solid var(--outline-variant)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'12px', flexWrap:'wrap'}}>
              <span style={{fontWeight:600, fontSize:'14px'}}>Qo'ng'iroqlar jurnali ({filtered.length})</span>
              <div style={{display:'flex', gap:'8px'}}>
                <select className="pipeline-selector" style={{fontSize:'12px'}} value={filterOp} onChange={e=>setFilterOp(e.target.value)}>
                  <option value="all">Barcha operator</option>
                  {operatorNames.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <select className="pipeline-selector" style={{fontSize:'12px'}} value={filterDir} onChange={e=>setFilterDir(e.target.value)}>
                  <option value="all">Barcha yo'nalish</option>
                  <option value="in">Kiruvchi</option>
                  <option value="out">Chiquvchi</option>
                </select>
                <select className="pipeline-selector" style={{fontSize:'12px'}} value={filterSt} onChange={e=>setFilterSt(e.target.value)}>
                  <option value="all">Barcha holat</option>
                  <option value="answered">Javob berildi</option>
                  <option value="missed">O'tkazildi</option>
                </select>
              </div>
            </div>
            <table>
              <thead><tr><th>Vaqt</th><th>Yo'nalish</th><th>Mijoz</th><th>Telefon</th><th>Operator</th><th>Holat</th><th>Izoh / Yozuv</th></tr></thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan="7" style={{textAlign:'center', padding:'40px', color:'var(--text-muted)'}}>
                    {allCalls.length === 0
                      ? "Hozircha qo'ng'iroqlar mavjud emas. Yuqoridagi tugma orqali qo'ng'iroq qayd eting."
                      : "Filtr bo'yicha natija topilmadi."}
                  </td></tr>
                )}
                {filtered.slice(0, 100).map((c, i) => (
                  <tr key={i}>
                    <td style={{fontSize:'11px', color:'var(--text-muted)', whiteSpace:'nowrap'}}>
                      {new Date(c.date).toLocaleString()}
                    </td>
                    <td>
                      <span style={{
                        padding:'2px 8px', borderRadius:'10px', fontSize:'10px', fontWeight:700,
                        background: c.direction==='in' ? 'rgba(59,130,246,0.12)' : 'rgba(90,223,129,0.1)',
                        color:      c.direction==='in' ? '#3b82f6' : 'var(--primary)',
                        border:`1px solid ${c.direction==='in' ? 'rgba(59,130,246,0.3)' : 'rgba(90,223,129,0.25)'}`,
                      }}>
                        {c.direction==='in' ? '⬇ Kiruvchi' : '⬆ Chiquvchi'}
                      </span>
                    </td>
                    <td style={{fontWeight:600}}>{c.leadName}</td>
                    <td style={{color:'var(--text-muted)', fontSize:'12px'}}>{c.phone}</td>
                    <td>
                      <span style={{background:'var(--surface-variant)', padding:'2px 8px', borderRadius:'10px', fontSize:'11px'}}>
                        {c.operator}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        padding:'3px 9px', borderRadius:'20px', fontSize:'10px', fontWeight:700, textTransform:'uppercase',
                        background: c.status==='answered' ? 'rgba(1,167,80,0.12)' : 'rgba(239,68,68,0.1)',
                        color:      c.status==='answered' ? '#01a750' : '#ef4444',
                        border:`1px solid ${c.status==='answered' ? 'rgba(1,167,80,0.3)' : 'rgba(239,68,68,0.3)'}`,
                      }}>
                        {c.status==='answered' ? 'Javob' : "O'tkazildi"}
                      </span>
                    </td>
                    <td style={{fontSize:'11px', color:'var(--text-muted)', maxWidth:'200px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                      {c.recordUrl
                        ? <a href={c.recordUrl} target="_blank" rel="noreferrer" style={{color:'var(--primary)', textDecoration:'none'}}>🎙 Yozuv tinglash</a>
                        : c.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ===== DRILL-DOWN MODAL ===== */}
          {drillDown && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.72)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}
              onClick={() => setDrillDown(null)}>
              <div style={{background:'var(--bg-surface)',borderRadius:'14px',width:'740px',maxWidth:'95vw',maxHeight:'82vh',display:'flex',flexDirection:'column',boxShadow:'0 12px 48px rgba(0,0,0,0.55)'}}
                onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{padding:'18px 22px',borderBottom:'1px solid var(--outline-variant)',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                  <div style={{fontWeight:700,fontSize:'15px'}}>{drillDown.title}</div>
                  <button onClick={() => setDrillDown(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)',fontSize:'22px',lineHeight:1,padding:'0 4px'}}>✕</button>
                </div>

                {/* Table */}
                <div style={{overflowY:'auto',flex:1}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{background:'var(--bg-hover)',position:'sticky',top:0}}>
                        {['Vaqt','Mijoz','Telefon','Holat','Izoh'].map(h => (
                          <th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:'11px',color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {drillDown.items.length === 0 && (
                        <tr><td colSpan="5" style={{textAlign:'center',padding:'40px',color:'var(--text-muted)',fontSize:'13px'}}>Ma'lumot topilmadi</td></tr>
                      )}
                      {drillDown.items.map((c, i) => (
                        <tr key={i}
                          style={{borderBottom:'1px solid var(--outline-variant)',cursor:'pointer',transition:'background 0.1s'}}
                          onClick={() => { setSelectedLeadId(c.leadId); setDrillDown(null); }}
                          onMouseEnter={e => e.currentTarget.style.background='var(--bg-hover)'}
                          onMouseLeave={e => e.currentTarget.style.background=''}>
                          <td style={{padding:'10px 16px',fontSize:'11px',color:'var(--text-muted)',whiteSpace:'nowrap'}}>{c.date ? new Date(c.date).toLocaleString() : '—'}</td>
                          <td style={{padding:'10px 16px',fontWeight:600,fontSize:'13px',color:'var(--primary)'}}>{c.leadName}</td>
                          <td style={{padding:'10px 16px',fontSize:'12px',color:'var(--text-muted)'}}>{c.phone}</td>
                          <td style={{padding:'10px 16px'}}>
                            <span style={{padding:'2px 9px',borderRadius:'20px',fontSize:'10px',fontWeight:700,textTransform:'uppercase',
                              background:c.status==='answered'?'rgba(1,167,80,0.12)':'rgba(239,68,68,0.1)',
                              color:c.status==='answered'?'#01a750':'#ef4444',
                              border:`1px solid ${c.status==='answered'?'rgba(1,167,80,0.3)':'rgba(239,68,68,0.3)'}`}}>
                              {c.status==='answered' ? 'Javob' : "O'tkazildi"}
                            </span>
                          </td>
                          <td style={{padding:'10px 16px',fontSize:'11px',color:'var(--text-muted)',maxWidth:'180px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer */}
                <div style={{padding:'11px 22px',borderTop:'1px solid var(--outline-variant)',fontSize:'12px',color:'var(--text-muted)',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                  <span>Jami: <b style={{color:'var(--text-main)'}}>{drillDown.items.length}</b> ta yozuv</span>
                  <span style={{display:'flex',alignItems:'center',gap:'5px'}}>
                    <span className="material-symbols-outlined" style={{fontSize:'13px'}}>touch_app</span>
                    Mijoz ustiga bosing — kartasini ochadi
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    };

    // ===== HISOBOTLAR (REPORTS) MODULE =====
    const HisobotlarModule = ({ leads, columnsMap, pipelines, setSelectedLeadId }) => {
      const [period, setPeriod]       = useState('all');
      const [pipeFilter, setPipeFilter] = useState('all');

      // ---- helpers ----
      const SOURCE_LABELS = { meta_fb_ads:'Facebook Ads', telegram_bot:'Telegram Bot', phone_call:'Telefon', referral:'Tavsiya', website:'Veb-sayt', manual:"Qo'lda kiritilgan", voip_incoming:'VoIP Kiruvchi', instagram:'Instagram DM' };
      const SOURCE_COLORS = { meta_fb_ads:'#1877F2', telegram_bot:'#0088cc', phone_call:'#01a750', referral:'#9333EA', website:'#ea580c', manual:'#6b7280', voip_incoming:'#f59e0b', instagram:'#E1306C' };

      const filterByPeriod = (arr) => {
        if (period === 'all') return arr;
        const now = new Date();
        return arr.filter(l => {
          const d = new Date(l.chatLogs?.[0]?.date || l.created_at || 0);
          if (period === 'today') return d.toDateString() === now.toDateString();
          const days = period === 'week' ? 7 : 30;
          return (now - d) <= days * 86400000;
        });
      };

      const pipeLeads = pipeFilter === 'all' ? leads : leads.filter(l => String(l.pipelineId) === String(pipeFilter));
      const fl = filterByPeriod(pipeLeads);

      // Dynamic stages from actual columnsMap
      const allColsFlat = Object.values(columnsMap || {}).flat();
      const uniqueStages = [...new Map(allColsFlat.map(c => [c.id, c])).values()];

      // Dynamic sources from actual lead data
      const allSources = [...new Set(fl.map(l => l.source).filter(Boolean))].sort((a,b) =>
        fl.filter(l=>l.source===b).length - fl.filter(l=>l.source===a).length
      );

      const maxSource = Math.max(1, ...allSources.map(s => fl.filter(l=>l.source===s).length));
      const maxStage  = Math.max(1, ...uniqueStages.map(s => fl.filter(l=>l.status===s.id).length));

      const wonCol  = allColsFlat.find(c => /yutildi|won/i.test(c.title||'') || c.id==='WON');
      const lostCol = allColsFlat.find(c => /yo.qot|lost/i.test(c.title||'') || c.id==='LOST');
      const won  = fl.filter(l => wonCol  ? l.status===wonCol.id  : l.status==='WON').length;
      const lost = fl.filter(l => lostCol ? l.status===lostCol.id : l.status==='LOST').length;
      const conversion = fl.length ? Math.round(won/fl.length*100) : 0;
      const totalCalls = fl.reduce((s,l)=>s+(l.actualCallAttempts||0),0);
      const allOwners  = [...new Set(fl.map(l=>l.owner).filter(Boolean))];

      // Funnel — use pipeline's ordered stages
      const pipeStages = (pipeFilter!=='all' && columnsMap?.[pipeFilter])
        ? columnsMap[pipeFilter]
        : (columnsMap?.[Object.keys(columnsMap||{})[0]] || []);

      // Weekly trend — last 8 weeks
      const weekTrend = Array.from({length:8}, (_,i) => {
        const wEnd   = new Date(); wEnd.setDate(wEnd.getDate() - (7-i)*7); wEnd.setHours(23,59,59,999);
        const wStart = new Date(wEnd); wStart.setDate(wEnd.getDate()-6); wStart.setHours(0,0,0,0);
        const count  = leads.filter(l => { const d=new Date(l.chatLogs?.[0]?.date||0); return d>=wStart&&d<=wEnd; }).length;
        return { label:`${wStart.getDate()}/${wStart.getMonth()+1}`, count };
      });
      const maxWeek = Math.max(1, ...weekTrend.map(w=>w.count));

      // SLA
      const now       = new Date();
      const slaOver   = fl.filter(l=>l.deadline && new Date(l.deadline)<now).length;
      const slaWarn   = fl.filter(l=>l.deadline && new Date(l.deadline)>now && (new Date(l.deadline)-now)<7200000).length;
      const slaOk     = fl.filter(l=>l.deadline && new Date(l.deadline)>now && (new Date(l.deadline)-now)>=7200000).length;
      const slaNoTask = fl.filter(l=>!l.deadline && !( (wonCol?l.status===wonCol.id:l.status==='WON') || (lostCol?l.status===lostCol.id:l.status==='LOST') || l.status==='NEW' )).length;

      const exportCSV = () => {
        const headers = ['ID','Ism','Telefon','Manzil','Manba','Bosqich',"Mas'ul","Qo'ng'iroqlar",'Muddat'];
        const rows = fl.map(l=>[l.id,l.name,l.phone||'',l.region||'',l.source||'',l.status||'',l.owner||'',l.actualCallAttempts||0,l.deadline?new Date(l.deadline).toLocaleString():'']);
        const csv = [headers,...rows].map(r=>r.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
        const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`mizon_${period}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
      };

      return (
        <div>
          {/* ── Header ── */}
          <div className="mod-header">
            <div>
              <div className="mod-title">Hisobotlar</div>
              <div className="mod-sub">Tahlil, grafik va ma'lumotlarni eksport qilish</div>
            </div>
            <div style={{display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap'}}>
              <select className="pipeline-selector" value={pipeFilter} onChange={e=>setPipeFilter(e.target.value)}>
                <option value="all">Barcha quvur</option>
                {(pipelines||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className="pipeline-selector" value={period} onChange={e=>setPeriod(e.target.value)}>
                <option value="all">Barcha vaqt</option>
                <option value="today">Bugun</option>
                <option value="week">So'nggi 7 kun</option>
                <option value="month">So'nggi 30 kun</option>
              </select>
              <button className="btn-primary" onClick={exportCSV}><Ico n="download" s={14}/> CSV Eksport</button>
            </div>
          </div>

          {/* ── KPI cards ── */}
          <div className="stat-mini-grid">
            {[
              {label:"Jami leadlar",      val:fl.length,       color:'var(--text-main)'},
              {label:"Konversiya",         val:conversion+'%',  color:'#01a750'},
              {label:"Yutilgan",           val:won,             color:'#01a750'},
              {label:"Yo'qotilgan",        val:lost,            color:'#ef4444'},
              {label:"Jami qo'ng'iroqlar", val:totalCalls,      color:'#3b82f6'},
              {label:"Kechikkan SLA",      val:slaOver,         color:'#ef4444'},
            ].map((m,i)=>(
              <div key={i} className="stat-mini">
                <div className="stat-mini-label">{m.label}</div>
                <div className="stat-mini-value" style={{color:m.color}}>{m.val}</div>
              </div>
            ))}
          </div>

          {/* ── Weekly trend ── */}
          <div className="card" style={{marginBottom:'14px'}}>
            <div className="card-title" style={{marginBottom:'12px'}}>Haftalik yangi leadlar trendi (so'nggi 8 hafta)</div>
            <div style={{display:'flex', alignItems:'flex-end', gap:'6px', height:'88px', padding:'0 2px'}}>
              {weekTrend.map((w,i)=>(
                <div key={i} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'3px'}}>
                  <div style={{fontSize:'10px', fontWeight:700, color:w.count>0?'var(--primary)':'transparent', minHeight:'14px'}}>{w.count||''}</div>
                  <div style={{width:'100%', background:'var(--bg-hover)', borderRadius:'4px 4px 0 0', height:'58px', position:'relative', overflow:'hidden'}}>
                    <div style={{
                      position:'absolute', bottom:0, width:'100%',
                      height:`${Math.max(0,(w.count/maxWeek)*100)}%`,
                      background:'linear-gradient(to top, var(--primary-container), var(--primary))',
                      borderRadius:'3px 3px 0 0', minHeight:w.count>0?'4px':'0',
                      transition:'height 0.5s ease'
                    }}/>
                  </div>
                  <div style={{fontSize:'9px', color:'var(--text-muted)', whiteSpace:'nowrap'}}>{w.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Source + Stage bars ── */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px'}}>
            <div className="card">
              <div className="card-title" style={{marginBottom:'14px'}}>Manba bo'yicha</div>
              {allSources.length===0
                ? <div style={{color:'var(--text-muted)',fontSize:'13px',textAlign:'center',padding:'20px 0'}}>Ma'lumot yo'q</div>
                : allSources.map(s=>{
                    const cnt=fl.filter(l=>l.source===s).length;
                    return (
                      <div key={s} className="chart-bar-row">
                        <span className="chart-bar-label">{SOURCE_LABELS[s]||s}</span>
                        <div className="chart-bar-track"><div className="chart-bar-fill" style={{width:`${cnt/maxSource*100}%`, background:SOURCE_COLORS[s]||'#8b5cf6'}}></div></div>
                        <span className="chart-bar-val">{cnt}</span>
                      </div>
                    );
                  })
              }
            </div>
            <div className="card">
              <div className="card-title" style={{marginBottom:'14px'}}>Bosqich bo'yicha (hozirgi holat)</div>
              {uniqueStages.length===0
                ? <div style={{color:'var(--text-muted)',fontSize:'13px',textAlign:'center',padding:'20px 0'}}>Ma'lumot yo'q</div>
                : uniqueStages.map(s=>{
                    const cnt=fl.filter(l=>l.status===s.id).length;
                    return (
                      <div key={s.id} className="chart-bar-row">
                        <span className="chart-bar-label">{s.title||s.id}</span>
                        <div className="chart-bar-track"><div className="chart-bar-fill" style={{width:`${cnt/maxStage*100}%`, background:colColors[s.id]||'var(--primary-container)'}}></div></div>
                        <span className="chart-bar-val">{cnt}</span>
                      </div>
                    );
                  })
              }
            </div>
          </div>

          {/* ── Funnel + SLA ── */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px'}}>
            <div className="card">
              <div className="card-title" style={{marginBottom:'14px'}}>Varonka konversiyasi</div>
              {pipeStages.length===0
                ? <div style={{color:'var(--text-muted)',fontSize:'13px',textAlign:'center',padding:'20px 0'}}>Quvur tanlanmagan yoki bosqichlar yo'q</div>
                : pipeStages.map((s,i)=>{
                    const cnt = fl.filter(l=>l.status===s.id).length;
                    const pct = fl.length ? Math.round(cnt/fl.length*100) : 0;
                    return (
                      <div key={s.id} style={{marginBottom:'8px'}}>
                        <div style={{display:'flex', justifyContent:'space-between', marginBottom:'3px'}}>
                          <span style={{fontSize:'12px', color:'var(--text-secondary)', fontWeight:500}}>{s.title||s.id}</span>
                          <span style={{fontSize:'12px', fontWeight:700, color:colColors[s.id]||'var(--text-main)'}}>
                            {cnt} <span style={{color:'var(--text-muted)', fontWeight:400}}>({pct}%)</span>
                          </span>
                        </div>
                        <div style={{background:'var(--bg-hover)', borderRadius:'4px', height:'10px', overflow:'hidden'}}>
                          <div style={{
                            width:`${pct}%`, height:'100%',
                            background:`linear-gradient(90deg, ${colColors[s.id]||'#6366f1'}, ${colColors[s.id]||'#6366f1'}88)`,
                            borderRadius:'4px', transition:'width 0.5s ease', minWidth:pct>0?'6px':'0'
                          }}/>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
            <div className="card">
              <div className="card-title" style={{marginBottom:'14px'}}>SLA holati</div>
              {[
                {label:"Kechikkan (o'tgan muddat)", val:slaOver, color:'#ef4444', bg:'rgba(239,68,68,0.1)', icon:'timer_off'},
                {label:"Yaqinlashgan (< 2 soat)",   val:slaWarn, color:'#f59e0b', bg:'rgba(245,158,11,0.1)', icon:'hourglass_top'},
                {label:"O'z vaqtida",                val:slaOk,   color:'#01a750', bg:'rgba(1,167,80,0.1)',   icon:'task_alt'},
                {label:"Vazifasiz faol leadlar",      val:slaNoTask, color:'#8b5cf6', bg:'rgba(139,92,246,0.1)', icon:'warning'},
              ].map((item,i)=>(
                <div key={i} style={{display:'flex', alignItems:'center', gap:'12px', padding:'10px', background:item.bg, borderRadius:'8px', border:`1px solid ${item.color}33`, marginBottom:'8px'}}>
                  <span className="material-symbols-outlined" style={{fontSize:'20px', color:item.color, flexShrink:0}}>{item.icon}</span>
                  <div style={{flex:1, fontSize:'12px', color:'var(--text-secondary)'}}>{item.label}</div>
                  <div style={{fontWeight:700, fontSize:'20px', color:item.color, minWidth:'28px', textAlign:'right'}}>{item.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Operators + Extra KPIs ── */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'14px'}}>
            <div className="card">
              <div className="card-title" style={{marginBottom:'14px'}}>Xodimlar samaradorligi</div>
              {allOwners.length===0
                ? <div style={{color:'var(--text-muted)',fontSize:'13px',textAlign:'center',padding:'20px 0'}}>Ma'lumot yo'q</div>
                : allOwners.map(op=>{
                    const opL    = fl.filter(l=>l.owner===op);
                    const opWon  = opL.filter(l=>wonCol?l.status===wonCol.id:l.status==='WON').length;
                    const opCalls= opL.reduce((s,l)=>s+(l.actualCallAttempts||0),0);
                    const maxOp  = Math.max(1,...allOwners.map(o=>fl.filter(l=>l.owner===o).length));
                    const cvr    = opL.length?Math.round(opWon/opL.length*100):0;
                    return (
                      <div key={op} style={{display:'flex', alignItems:'center', gap:'10px', padding:'10px', background:'var(--bg-base)', borderRadius:'8px', border:'1px solid var(--border-light)', marginBottom:'8px'}}>
                        <div className="avatar" style={{width:'34px', height:'34px', fontSize:'13px'}}>{op[0].toUpperCase()}</div>
                        <div style={{flex:1}}>
                          <div style={{display:'flex', justifyContent:'space-between', marginBottom:'5px'}}>
                            <span style={{fontWeight:600, fontSize:'13px'}}>{op}</span>
                            <span style={{fontSize:'11px', color:'var(--text-muted)'}}>{opL.length} lead · {opCalls} 📞 · {cvr}% CVR</span>
                          </div>
                          <div className="chart-bar-track" style={{height:'5px'}}>
                            <div className="chart-bar-fill" style={{width:`${opL.length/maxOp*100}%`, background:opWon>0?'#01a750':'var(--primary-container)'}}></div>
                          </div>
                        </div>
                        <div style={{fontSize:'14px', fontWeight:700, color:'#01a750', minWidth:'24px', textAlign:'right'}}>{opWon}</div>
                      </div>
                    );
                  })
              }
            </div>
            <div className="card">
              <div className="card-title" style={{marginBottom:'14px'}}>Qo'shimcha ko'rsatkichlar</div>
              {(() => {
                const bestSrc = allSources[0];
                const bestOp  = [...allOwners].sort((a,b)=>fl.filter(l=>l.owner===b&&(wonCol?l.status===wonCol.id:l.status==='WON')).length-fl.filter(l=>l.owner===a&&(wonCol?l.status===wonCol.id:l.status==='WON')).length)[0];
                return [
                  {label:"O'rtacha qo'ng'iroq / lead", val:fl.length?(totalCalls/fl.length).toFixed(1):'0',        icon:'analytics',      color:'#8b5cf6'},
                  {label:"Eng faol manba",              val:bestSrc?(SOURCE_LABELS[bestSrc]||bestSrc):'—',           icon:'trending_up',    color:'#01a750'},
                  {label:"Eng samarali xodim",          val:bestOp||'—',                                             icon:'emoji_events',   color:'#f59e0b'},
                  {label:"Yopilmagan leadlar",          val:fl.filter(l=>!(wonCol?l.status===wonCol.id:l.status==='WON')&&!(lostCol?l.status===lostCol.id:l.status==='LOST')).length, icon:'pending_actions', color:'#3b82f6'},
                ].map((item,i)=>(
                  <div key={i} style={{display:'flex', alignItems:'center', gap:'12px', padding:'10px', background:'var(--bg-base)', borderRadius:'8px', border:'1px solid var(--border-light)', marginBottom:'8px'}}>
                    <div style={{width:'32px', height:'32px', borderRadius:'8px', background:`${item.color}18`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                      <span className="material-symbols-outlined" style={{fontSize:'17px', color:item.color}}>{item.icon}</span>
                    </div>
                    <div style={{flex:1, fontSize:'12px', color:'var(--text-secondary)'}}>{item.label}</div>
                    <div style={{fontWeight:700, fontSize:'15px', color:item.color, textAlign:'right', maxWidth:'130px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{item.val}</div>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* ── Full leads table (clickable) ── */}
          <div className="card" style={{padding:0, overflow:'hidden', marginBottom:'16px'}}>
            <div style={{padding:'14px 20px', borderBottom:'1px solid var(--outline-variant)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <span style={{fontWeight:600, fontSize:'14px'}}>To'liq lead hisoboti ({fl.length})</span>
              <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
                {setSelectedLeadId && <span style={{fontSize:'11px', color:'var(--text-muted)'}}>← Qatorni bosib lead'ni oching</span>}
                <button className="btn-outline" style={{padding:'6px 12px'}} onClick={exportCSV}><Ico n="download" s={13}/> Yuklab olish</button>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Ism</th><th>Telefon</th><th>Manba</th>
                  <th>Bosqich</th><th>Mas'ul</th><th>📞</th><th>Muddat</th>
                </tr>
              </thead>
              <tbody>
                {fl.length===0 && (
                  <tr><td colSpan="8" style={{textAlign:'center', padding:'30px', color:'var(--text-muted)'}}>
                    Tanlangan davr / filtr uchun ma'lumot topilmadi
                  </td></tr>
                )}
                {fl.map(l=>{
                  const slaTp = determineSLAType(l.deadline);
                  const stageTitle = uniqueStages.find(s=>s.id===l.status)?.title || l.status;
                  return (
                    <tr key={l.id}
                      style={{cursor:setSelectedLeadId?'pointer':'default', borderLeft:`3px solid ${slaTp==='danger'?'var(--danger)':slaTp==='warning'?'var(--warning)':'transparent'}`}}
                      onClick={()=>setSelectedLeadId&&setSelectedLeadId(l.id)}
                      onMouseEnter={e=>{if(setSelectedLeadId)e.currentTarget.style.background='var(--bg-hover)';}}
                      onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={{color:'var(--text-muted)', fontSize:'11px', paddingLeft:'14px'}}>#{l.id}</td>
                      <td style={{fontWeight:600}}>{l.name}</td>
                      <td style={{fontSize:'12px', color:'var(--text-muted)'}}>{l.phone||'—'}</td>
                      <td><span className={`source-badge badge-${l.source}`}>{(SOURCE_LABELS[l.source]||l.source||'').replace('meta_fb_ads','fb_ads').replace('telegram_bot','telegram')}</span></td>
                      <td><span style={{fontSize:'11px', fontWeight:600, padding:'2px 9px', borderRadius:'4px', background:(colColors[l.status]||'#888')+'22', color:colColors[l.status]||'var(--text-muted)'}}>{stageTitle}</span></td>
                      <td>{l.owner||'—'}</td>
                      <td style={{fontWeight:600, textAlign:'center'}}>{l.actualCallAttempts||0}</td>
                      <td style={{fontSize:'11px', color:slaTp==='danger'?'var(--danger)':slaTp==='warning'?'var(--warning)':'var(--text-muted)'}}>
                        {l.deadline ? new Date(l.deadline).toLocaleDateString('uz-Cyrl-UZ',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Task 2: Harakatlar Jurnali (Activity Log) ── */}
          {(() => {
            // Barcha leadlardan sys va audit chatlog yozuvlarini yig'amiz
            const actLogs = [];
            leads.forEach(l => {
              const logs = Array.isArray(l.chatLogs) ? l.chatLogs : [];
              logs.forEach(log => {
                if (log.type === 'sys' || log.type === 'audit') {
                  actLogs.push({ ...log, leadId: l.id, leadName: l.name, leadPhone: l.phone });
                }
              });
            });
            // Sanaga qarab tartiblash (yangi birinchi)
            actLogs.sort((a,b) => new Date(b.date) - new Date(a.date));
            const shown = actLogs.slice(0, 200);
            return (
              <div className="card" style={{padding:0, overflow:'hidden', marginTop:'16px'}}>
                <div style={{padding:'14px 20px', borderBottom:'1px solid var(--outline-variant)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <div>
                    <span style={{fontWeight:600, fontSize:'14px'}}>📋 Harakatlar Jurnali</span>
                    <span style={{fontSize:'11px', color:'var(--text-muted)', marginLeft:'10px'}}>(so'nggi {shown.length} ta yozuv)</span>
                  </div>
                </div>
                {shown.length === 0 ? (
                  <div style={{padding:'30px', textAlign:'center', color:'var(--text-muted)', fontSize:'13px'}}>
                    Hali hech qanday harakat qayd etilmagan
                  </div>
                ) : (
                  <div style={{maxHeight:'400px', overflowY:'auto'}}>
                    {shown.map((log, idx) => {
                      const isAudit = log.type === 'audit';
                      const dt = new Date(log.date);
                      const dtStr = dt.toLocaleDateString('uz-UZ', {day:'2-digit',month:'2-digit',year:'2-digit'}) + ' ' + dt.toLocaleTimeString('uz-UZ', {hour:'2-digit',minute:'2-digit'});
                      return (
                        <div key={idx} style={{display:'flex', gap:'12px', alignItems:'flex-start', padding:'10px 20px', borderBottom:'1px solid var(--outline-variant)', cursor:setSelectedLeadId?'pointer':'default'}}
                          onClick={()=>setSelectedLeadId&&setSelectedLeadId(log.leadId)}
                          onMouseEnter={e=>{if(setSelectedLeadId)e.currentTarget.style.background='var(--bg-hover)';}}
                          onMouseLeave={e=>e.currentTarget.style.background=''}>
                          <div style={{width:'6px', height:'6px', borderRadius:'50%', background:isAudit?'#3b82f6':'var(--text-muted)', marginTop:'6px', flexShrink:0}}></div>
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{fontSize:'12px', color:'var(--text-secondary)', lineHeight:1.4}}>{log.text}</div>
                            <div style={{display:'flex', gap:'10px', marginTop:'3px'}}>
                              <span style={{fontSize:'10px', color:'var(--text-muted)'}}>{dtStr}</span>
                              {log.leadName && (
                                <span style={{fontSize:'10px', color:'var(--primary)', fontWeight:600}}>
                                  {log.leadName}{log.leadPhone ? ` · ${log.leadPhone}` : ''}
                                </span>
                              )}
                              {log.by && <span style={{fontSize:'10px', color:'var(--text-muted)'}}>by {log.by}</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      );
    };

    // ===== AUTOMATION MODULE =====
    const AutomationModule = ({ getAuthHeaders }) => {
      const TRIGGERS = [
        { value: 'lead_created',  label: 'Lead yaratilganda' },
        { value: 'stage_changed', label: 'Bosqich o\'zgarganda' },
        { value: 'ig_dm',         label: 'Instagram DM kelganda' },
      ];
      const ACTION_TYPES = [
        { value: 'sms',      label: '📱 SMS yuborish (Eskiz.uz)' },
        { value: 'ig_reply', label: '📸 Instagram javob yuborish' },
      ];

      const [tab,          setTab]          = useState('settings'); // settings | templates | rules | logs
      const [smsSettings,  setSmsSettings]  = useState({ eskiz_email: '' });
      const [smsForm,      setSmsForm]      = useState({ eskiz_email: '', eskiz_password: '' });
      const [smsTesting,   setSmsTesting]   = useState(false);
      const [smsSaving,    setSmsSaving]    = useState(false);
      const [templates,    setTemplates]    = useState([]);
      const [rules,        setRules]        = useState([]);
      const [logs,         setLogs]         = useState([]);
      const [stages,       setStages]       = useState([]);
      const [msg,          setMsg]          = useState('');
      const [tplModal,     setTplModal]     = useState(null); // null | {} | {id,...}
      const [ruleModal,    setRuleModal]    = useState(null);
      const flash = (m) => { setMsg(m); setTimeout(()=>setMsg(''), 4000); };

      const H = () => ({ ...getAuthHeaders(), 'Content-Type': 'application/json' });
      const api = async (method, path, body) => {
        const r = await fetch(path, { method, headers: H(), body: body ? JSON.stringify(body) : undefined });
        return r.json();
      };

      useEffect(() => {
        fetch('/api/automation/sms-settings', { headers: H() }).then(r=>r.json()).then(d => {
          setSmsSettings(d); setSmsForm({ eskiz_email: d.eskiz_email||'', eskiz_password: '' });
        });
        fetch('/api/automation/templates', { headers: H() }).then(r=>r.json()).then(setTemplates);
        fetch('/api/automation/rules',     { headers: H() }).then(r=>r.json()).then(setRules);
        fetch('/api/stages',               { headers: H() }).then(r=>r.json()).then(d => setStages(d.stages||[]));
      }, []);

      useEffect(() => {
        if (tab === 'logs') fetch('/api/automation/logs', { headers: H() }).then(r=>r.json()).then(setLogs);
      }, [tab]);

      const saveSms = async (e) => {
        e.preventDefault(); setSmsSaving(true);
        const d = await api('POST', '/api/automation/sms-settings', smsForm);
        setSmsSaving(false);
        if (d.success) flash('✅ SMS sozlamalari saqlandi');
        else flash('❌ ' + (d.error||'Xato'));
      };

      const testSms = async () => {
        setSmsTesting(true);
        const d = await api('POST', '/api/automation/sms-settings/test');
        setSmsTesting(false);
        flash(d.success ? '✅ ' + d.message : '❌ ' + (d.error||'Xato'));
      };

      const saveTpl = async (e) => {
        e.preventDefault();
        const { id, ...body } = tplModal;
        const d = id
          ? await api('PUT',  `/api/automation/templates/${id}`, body)
          : await api('POST', '/api/automation/templates', body);
        if (d.error) return flash('❌ ' + d.error);
        setTplModal(null);
        fetch('/api/automation/templates', { headers: H() }).then(r=>r.json()).then(setTemplates);
        flash('✅ Shablon saqlandi');
      };

      const deleteTpl = async (id) => {
        if (!window.confirm('Shablonni o\'chirish?')) return;
        await api('DELETE', `/api/automation/templates/${id}`);
        setTemplates(prev => prev.filter(t => t.id !== id));
      };

      const saveRule = async (e) => {
        e.preventDefault();
        const { id, ...body } = ruleModal;
        const d = id
          ? await api('PUT',  `/api/automation/rules/${id}`, body)
          : await api('POST', '/api/automation/rules', body);
        if (d.error) return flash('❌ ' + d.error);
        setRuleModal(null);
        fetch('/api/automation/rules', { headers: H() }).then(r=>r.json()).then(setRules);
        flash('✅ Qoida saqlandi');
      };

      const toggleRule = async (rule) => {
        await api('PUT', `/api/automation/rules/${rule.id}`, { is_active: !rule.is_active });
        setRules(prev => prev.map(r => r.id === rule.id ? {...r, is_active: !r.is_active} : r));
      };

      const deleteRule = async (id) => {
        if (!window.confirm('Qoidani o\'chirish?')) return;
        await api('DELETE', `/api/automation/rules/${id}`);
        setRules(prev => prev.filter(r => r.id !== id));
      };

      const VARS = ['{ism}','{telefon}','{menejer}','{bosqich}','{region}','{sana}'];

      const cardStyle = { background:'var(--bg-surface)', border:'1px solid var(--outline-variant)', borderRadius:'12px', padding:'20px', marginBottom:'14px' };
      const tabStyle  = (active) => ({
        padding:'8px 18px', borderRadius:'8px', cursor:'pointer', fontSize:'13px', fontWeight:600,
        background: active ? 'var(--primary-container)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        border: 'none'
      });
      const inputStyle = { width:'100%', padding:'9px 12px', borderRadius:'8px', border:'1px solid var(--outline-variant)', background:'var(--bg-base)', color:'var(--text-main)', fontSize:'13px', boxSizing:'border-box' };

      return (
        <div style={{padding:'24px', maxWidth:'900px'}}>
          <h2 style={{fontSize:'20px', fontWeight:700, marginBottom:'4px'}}>Avtomatizatsiya</h2>
          <p style={{color:'var(--text-muted)', fontSize:'13px', marginBottom:'20px'}}>SMS avtomatik yuborish qoidalari va shablonlari</p>

          {msg && (
            <div style={{padding:'10px 16px', borderRadius:'8px', marginBottom:'16px', fontSize:'13px',
              background: msg.startsWith('✅') ? 'rgba(90,223,129,0.1)' : 'rgba(255,80,80,0.1)',
              color: msg.startsWith('✅') ? 'var(--success)' : 'var(--danger)',
              border: `1px solid ${msg.startsWith('✅') ? 'rgba(90,223,129,0.3)' : 'rgba(255,80,80,0.3)'}`
            }}>{msg}</div>
          )}

          {/* Tabs */}
          <div style={{display:'flex', gap:'6px', marginBottom:'20px', background:'var(--bg-surface)', padding:'6px', borderRadius:'10px', width:'fit-content', border:'1px solid var(--outline-variant)'}}>
            {[['settings','settings','SMS Sozlamalar'],['templates','description','Shablonlar'],['rules','rule','Qoidalar'],['logs','history','Loglar']].map(([v,ic,label]) => (
              <button key={v} style={tabStyle(tab===v)} onClick={()=>setTab(v)}>
                <span className="material-symbols-outlined" style={{fontSize:'15px',verticalAlign:'middle',marginRight:'5px'}}>{ic}</span>{label}
              </button>
            ))}
          </div>

          {/* ── SMS Settings ── */}
          {tab === 'settings' && (
            <div>
              <div style={cardStyle}>
                <div style={{fontWeight:600, marginBottom:'16px', fontSize:'15px'}}>📱 Eskiz.uz SMS Hisob</div>
                <form onSubmit={saveSms}>
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'14px'}}>
                    <div>
                      <div style={{fontSize:'12px', color:'var(--text-muted)', marginBottom:'5px'}}>Email</div>
                      <input style={inputStyle} type="email" placeholder="eskiz@example.com"
                        value={smsForm.eskiz_email} onChange={e=>setSmsForm({...smsForm,eskiz_email:e.target.value})} required />
                    </div>
                    <div>
                      <div style={{fontSize:'12px', color:'var(--text-muted)', marginBottom:'5px'}}>Parol</div>
                      <input style={inputStyle} type="password" placeholder={smsSettings.eskiz_email ? '••••• (o\'zgartirish uchun kiriting)' : 'Parol'}
                        value={smsForm.eskiz_password} onChange={e=>setSmsForm({...smsForm,eskiz_password:e.target.value})} />
                    </div>
                  </div>
                  <div style={{display:'flex', gap:'10px'}}>
                    <button type="submit" className="btn-primary" style={{padding:'9px 20px'}} disabled={smsSaving}>
                      {smsSaving ? 'Saqlanmoqda...' : '💾 Saqlash'}
                    </button>
                    <button type="button" className="btn-outline" style={{padding:'9px 20px'}} onClick={testSms} disabled={smsTesting}>
                      {smsTesting ? 'Tekshirilmoqda...' : '🔌 Ulanishni tekshirish'}
                    </button>
                  </div>
                </form>
              </div>
              <div style={{...cardStyle, background:'rgba(90,223,129,0.05)', border:'1px solid rgba(90,223,129,0.2)'}}>
                <div style={{fontWeight:600, marginBottom:'10px', fontSize:'13px'}}>📝 Shablon o'zgaruvchilari</div>
                <div style={{display:'flex', flexWrap:'wrap', gap:'8px'}}>
                  {VARS.map(v => (
                    <code key={v} style={{background:'var(--surface-variant)', padding:'4px 10px', borderRadius:'6px', fontSize:'12px', color:'var(--primary)'}}>{v}</code>
                  ))}
                </div>
                <div style={{fontSize:'12px', color:'var(--text-muted)', marginTop:'8px'}}>
                  Shablon xabarlarida ushbu o'zgaruvchilardan foydalaning — yuborishda avtomatik almashtiriladi.
                </div>
              </div>
            </div>
          )}

          {/* ── Templates ── */}
          {tab === 'templates' && (
            <div>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px'}}>
                <div style={{fontWeight:600}}>Shablonlar ({templates.length})</div>
                <button className="btn-primary" style={{padding:'8px 16px', fontSize:'13px'}}
                  onClick={()=>setTplModal({name:'', message:''})}>+ Yangi shablon</button>
              </div>
              {templates.length === 0 && <div style={{color:'var(--text-muted)', fontSize:'13px', textAlign:'center', padding:'40px'}}>Hali shablon yo'q</div>}
              {templates.map(t => (
                <div key={t.id} style={cardStyle}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
                    <div>
                      <div style={{fontWeight:600, marginBottom:'6px'}}>{t.name}</div>
                      <div style={{fontSize:'13px', color:'var(--text-secondary)', whiteSpace:'pre-wrap', lineHeight:1.5}}>{t.message}</div>
                    </div>
                    <div style={{display:'flex', gap:'8px', flexShrink:0, marginLeft:'12px'}}>
                      <button className="btn-outline" style={{padding:'5px 12px', fontSize:'12px'}}
                        onClick={()=>setTplModal({id:t.id, name:t.name, message:t.message})}>Tahrirlash</button>
                      <button className="btn-outline" style={{padding:'5px 12px', fontSize:'12px', color:'var(--danger)', borderColor:'var(--danger)'}}
                        onClick={()=>deleteTpl(t.id)}>O'chirish</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Rules ── */}
          {tab === 'rules' && (
            <div>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px'}}>
                <div style={{fontWeight:600}}>Qoidalar ({rules.length})</div>
                <button className="btn-primary" style={{padding:'8px 16px', fontSize:'13px'}}
                  onClick={()=>setRuleModal({name:'', trigger_type:'lead_created', action_type:'sms', template_id:'', stage_filter:''})}>+ Yangi qoida</button>
              </div>
              {rules.length === 0 && <div style={{color:'var(--text-muted)', fontSize:'13px', textAlign:'center', padding:'40px'}}>Hali qoida yo'q</div>}
              {rules.map(r => (
                <div key={r.id} style={{...cardStyle, opacity: r.is_active ? 1 : 0.55}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <div style={{flex:1}}>
                      <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'6px'}}>
                        <span style={{fontWeight:600}}>{r.name}</span>
                        <span style={{fontSize:'11px', padding:'2px 8px', borderRadius:'20px',
                          background: r.is_active ? 'rgba(90,223,129,0.15)' : 'var(--surface-variant)',
                          color: r.is_active ? 'var(--success)' : 'var(--text-muted)'}}>
                          {r.is_active ? '● Faol' : '○ Nofaol'}
                        </span>
                      </div>
                      <div style={{fontSize:'12px', color:'var(--text-muted)', display:'flex', gap:'16px', flexWrap:'wrap'}}>
                        <span>⚡ {TRIGGERS.find(t=>t.value===r.trigger_type)?.label || r.trigger_type}</span>
                        <span>{ACTION_TYPES.find(a=>a.value===(r.action_type||'sms'))?.label || r.action_type}</span>
                        <span>📝 {r.template_name || '—'}</span>
                        {r.stage_filter && <span>🎯 Bosqich #{r.stage_filter}</span>}
                      </div>
                    </div>
                    <div style={{display:'flex', gap:'8px'}}>
                      <button className="btn-outline" style={{padding:'5px 12px', fontSize:'12px'}} onClick={()=>toggleRule(r)}>
                        {r.is_active ? 'O\'chirish' : 'Yoqish'}
                      </button>
                      <button className="btn-outline" style={{padding:'5px 12px', fontSize:'12px'}}
                        onClick={()=>setRuleModal({id:r.id, name:r.name, trigger_type:r.trigger_type, action_type:r.action_type||'sms', template_id:String(r.template_id||''), stage_filter:r.stage_filter||''})}>
                        Tahrirlash
                      </button>
                      <button className="btn-outline" style={{padding:'5px 12px', fontSize:'12px', color:'var(--danger)', borderColor:'var(--danger)'}}
                        onClick={()=>deleteRule(r.id)}>O'chirish</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Logs ── */}
          {tab === 'logs' && (
            <div>
              <div style={{fontWeight:600, marginBottom:'16px'}}>SMS Tarixi ({logs.length})</div>
              {logs.length === 0 && <div style={{color:'var(--text-muted)', fontSize:'13px', textAlign:'center', padding:'40px'}}>Hali log yo'q</div>}
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%', borderCollapse:'collapse', fontSize:'13px'}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--outline-variant)', color:'var(--text-muted)'}}>
                      <th style={{padding:'8px 12px', textAlign:'left', fontWeight:600}}>Vaqt</th>
                      <th style={{padding:'8px 12px', textAlign:'left', fontWeight:600}}>Lead</th>
                      <th style={{padding:'8px 12px', textAlign:'left', fontWeight:600}}>Telefon</th>
                      <th style={{padding:'8px 12px', textAlign:'left', fontWeight:600}}>Qoida</th>
                      <th style={{padding:'8px 12px', textAlign:'left', fontWeight:600}}>Holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id} style={{borderBottom:'1px solid var(--outline-variant)'}}>
                        <td style={{padding:'8px 12px', color:'var(--text-muted)', whiteSpace:'nowrap'}}>
                          {new Date(l.created_at).toLocaleString('uz-UZ')}
                        </td>
                        <td style={{padding:'8px 12px'}}>{l.lead_name||'—'}</td>
                        <td style={{padding:'8px 12px'}}>{l.phone}</td>
                        <td style={{padding:'8px 12px', color:'var(--text-secondary)'}}>{l.rule_name||'—'}</td>
                        <td style={{padding:'8px 12px'}}>
                          <span style={{padding:'2px 8px', borderRadius:'20px', fontSize:'11px',
                            background: l.status==='sent' ? 'rgba(90,223,129,0.15)' : 'rgba(255,80,80,0.15)',
                            color: l.status==='sent' ? 'var(--success)' : 'var(--danger)'}}>
                            {l.status==='sent' ? '✓ Yuborildi' : '✗ Xato'}
                          </span>
                          {l.error_msg && <div style={{fontSize:'11px', color:'var(--danger)', marginTop:'2px'}}>{l.error_msg}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Template Modal ── */}
          {tplModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}
              onClick={e=>{if(e.target===e.currentTarget)setTplModal(null);}}>
              <div style={{background:'var(--bg-surface)',borderRadius:'14px',padding:'24px',width:'100%',maxWidth:'520px',border:'1px solid var(--outline-variant)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}>
                  <div style={{fontWeight:700,fontSize:'16px'}}>{tplModal.id ? 'Shablonni tahrirlash' : 'Yangi shablon'}</div>
                  <button onClick={()=>setTplModal(null)} style={{background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
                </div>
                <form onSubmit={saveTpl}>
                  <div style={{marginBottom:'12px'}}>
                    <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'5px'}}>Shablon nomi</div>
                    <input style={inputStyle} placeholder="Masalan: Yangi lead SMS" value={tplModal.name}
                      onChange={e=>setTplModal({...tplModal,name:e.target.value})} required />
                  </div>
                  <div style={{marginBottom:'12px'}}>
                    <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'5px'}}>Xabar matni</div>
                    <textarea style={{...inputStyle,height:'120px',resize:'vertical'}} placeholder="Salom {ism}! Sizning arizangiz qabul qilindi."
                      value={tplModal.message} onChange={e=>setTplModal({...tplModal,message:e.target.value})} required />
                    <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'4px'}}>
                      O'zgaruvchilar: {VARS.join(' ')}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
                    <button type="button" className="btn-outline" style={{padding:'9px 20px'}} onClick={()=>setTplModal(null)}>Bekor</button>
                    <button type="submit" className="btn-primary" style={{padding:'9px 20px'}}>Saqlash</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ── Rule Modal ── */}
          {ruleModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}
              onClick={e=>{if(e.target===e.currentTarget)setRuleModal(null);}}>
              <div style={{background:'var(--bg-surface)',borderRadius:'14px',padding:'24px',width:'100%',maxWidth:'480px',border:'1px solid var(--outline-variant)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'18px'}}>
                  <div style={{fontWeight:700,fontSize:'16px'}}>{ruleModal.id ? 'Qoidani tahrirlash' : 'Yangi qoida'}</div>
                  <button onClick={()=>setRuleModal(null)} style={{background:'none',border:'none',fontSize:'20px',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
                </div>
                <form onSubmit={saveRule}>
                  <div style={{marginBottom:'12px'}}>
                    <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'5px'}}>Qoida nomi</div>
                    <input style={inputStyle} placeholder="Masalan: Yangi lead SMS yuborish" value={ruleModal.name}
                      onChange={e=>setRuleModal({...ruleModal,name:e.target.value})} required />
                  </div>
                  <div style={{marginBottom:'12px'}}>
                    <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'5px'}}>Trigger (qachon ishlaydi)</div>
                    <select style={inputStyle} value={ruleModal.trigger_type} onChange={e=>setRuleModal({...ruleModal,trigger_type:e.target.value})}>
                      {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div style={{marginBottom:'12px'}}>
                    <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'5px'}}>Amal (nima qiladi)</div>
                    <select style={inputStyle} value={ruleModal.action_type||'sms'} onChange={e=>setRuleModal({...ruleModal,action_type:e.target.value})}>
                      {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                  </div>
                  {ruleModal.trigger_type === 'stage_changed' && (
                    <div style={{marginBottom:'12px'}}>
                      <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'5px'}}>Bosqich filtri (ixtiyoriy)</div>
                      <select style={inputStyle} value={ruleModal.stage_filter||''} onChange={e=>setRuleModal({...ruleModal,stage_filter:e.target.value})}>
                        <option value="">Barcha bosqichlar</option>
                        {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{marginBottom:'16px'}}>
                    <div style={{fontSize:'12px',color:'var(--text-muted)',marginBottom:'5px'}}>SMS Shablon</div>
                    <select style={inputStyle} value={ruleModal.template_id} onChange={e=>setRuleModal({...ruleModal,template_id:e.target.value})} required>
                      <option value="">— Shablon tanlang —</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div style={{display:'flex',gap:'10px',justifyContent:'flex-end'}}>
                    <button type="button" className="btn-outline" style={{padding:'9px 20px'}} onClick={()=>setRuleModal(null)}>Bekor</button>
                    <button type="submit" className="btn-primary" style={{padding:'9px 20px'}}>Saqlash</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      );
    };

    // ===== MARKETING ANALYTICS MODULE (fully functional, localStorage) =====
    const MarketingModule = () => {
      // Kompaniya ID ni sessiyadan olamiz — localStorage kalitini izolyatsiya qilish uchun
      const _mktSession = (() => { try { return JSON.parse(localStorage.getItem('mizon_session')||'{}'); } catch{return {};} })();
      const _cid = _mktSession.companyId || 'local';
      const CAMP_KEY = `mizon_campaigns_${_cid}`;
      const TG_KEY   = `mizon_tg_${_cid}`;

      // ── Facebook kampaniyalar ──────────────────────────────────────────────────
      const [campaigns, setCampaigns] = useState(() => {
        try { return JSON.parse(localStorage.getItem(CAMP_KEY)||'[]'); } catch{return [];}
      });
      useEffect(() => { localStorage.setItem(CAMP_KEY, JSON.stringify(campaigns)); }, [campaigns]);

      const [showNew,    setShowNew]    = useState(false);
      const [editBudget, setEditBudget] = useState(null); // {id, val}
      const [editSpent,  setEditSpent]  = useState(null); // {id, val}
      const [editLeads,  setEditLeads]  = useState(null); // {id, val}
      const [newC, setNewC] = useState({name:'', budget:'', reach:''});

      const toggleStatus = (id) => setCampaigns(prev => prev.map(c => c.id===id?{...c,status:c.status==='active'?'paused':'active'}:c));
      const deleteCamp   = (id) => { if(window.confirm("Kampaniyani o'chirishni tasdiqlaysizmi?")) setCampaigns(prev=>prev.filter(c=>c.id!==id)); };
      const saveBudget   = () => { if(!editBudget) return; setCampaigns(prev=>prev.map(c=>c.id===editBudget.id?{...c,budget:Number(editBudget.val)||c.budget}:c)); setEditBudget(null); };
      const saveSpent    = () => { if(!editSpent)  return; setCampaigns(prev=>prev.map(c=>{ if(c.id!==editSpent.id) return c; const spent=Number(editSpent.val)||0; return {...c,spent,cpl:c.leads?Math.round(spent/c.leads):0}; })); setEditSpent(null); };
      const saveLeads    = () => { if(!editLeads)  return; setCampaigns(prev=>prev.map(c=>{ if(c.id!==editLeads.id) return c; const leads=Number(editLeads.val)||0; return {...c,leads,cpl:leads?Math.round(c.spent/leads):0}; })); setEditLeads(null); };
      const addCampaign  = () => {
        if(!newC.name||!newC.budget) return alert("Kampaniya nomi va byudjetni kiriting!");
        setCampaigns(prev=>[...prev,{id:'c_'+Date.now(),name:newC.name,status:'active',budget:Number(newC.budget),spent:0,leads:0,cpl:0,reach:Number(newC.reach)||0}]);
        setNewC({name:'',budget:'',reach:''}); setShowNew(false);
      };

      // ── Telegram kanallar ─────────────────────────────────────────────────────
      const [tgChannels, setTgChannels] = useState(() => {
        try { return JSON.parse(localStorage.getItem(TG_KEY)||'[]'); } catch{return [];}
      });
      useEffect(() => { localStorage.setItem(TG_KEY, JSON.stringify(tgChannels)); }, [tgChannels]);

      const [showNewTg, setShowNewTg] = useState(false);
      const [newTg, setNewTg] = useState({name:'', subscribers:'', posts:'', reach:'', clicks:'', joinRate:''});
      const [editTg, setEditTg] = useState(null); // full channel object being edited

      const addTgChannel = () => {
        if(!newTg.name) return alert("Kanal nomini kiriting!");
        setTgChannels(prev=>[...prev,{id:'t_'+Date.now(),name:newTg.name,subscribers:Number(newTg.subscribers)||0,posts:Number(newTg.posts)||0,reach:Number(newTg.reach)||0,clicks:Number(newTg.clicks)||0,joinRate:newTg.joinRate||''}]);
        setNewTg({name:'',subscribers:'',posts:'',reach:'',clicks:'',joinRate:''}); setShowNewTg(false);
      };
      const saveTgEdit = () => {
        if(!editTg) return;
        setTgChannels(prev=>prev.map(ch=>ch.id===editTg.id?{...editTg,subscribers:Number(editTg.subscribers)||0,posts:Number(editTg.posts)||0,reach:Number(editTg.reach)||0,clicks:Number(editTg.clicks)||0}:ch));
        setEditTg(null);
      };
      const deleteTg = (id) => { if(window.confirm("Kanalni o'chirishni tasdiqlaysizmi?")) setTgChannels(prev=>prev.filter(ch=>ch.id!==id)); };

      // ── Hisoblar ──────────────────────────────────────────────────────────────
      const fmt    = n => n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(0)+'K':String(n);
      const fmtSum = n => new Intl.NumberFormat('ru-RU').format(n)+" so'm";

      const totLeads = campaigns.reduce((s,c)=>s+c.leads,0);
      const totSpent = campaigns.reduce((s,c)=>s+c.spent,0);
      const avgCPL   = totLeads ? Math.round(totSpent/totLeads) : 0;
      const actCount = campaigns.filter(c=>c.status==='active').length;

      // ── Inline editor helper ──────────────────────────────────────────────────
      const InlineEdit = ({editState, setEdit, onSave, label}) => editState ? (
        <span>
          <input type="number" autoFocus style={{background:'var(--surface-variant)',border:'1px solid var(--border-hover)',borderRadius:'4px',padding:'1px 6px',color:'var(--text-main)',fontSize:'11px',width:'100px'}}
            value={editState.val} onChange={e=>setEdit({...editState,val:e.target.value})}
            onKeyDown={e=>{if(e.key==='Enter')onSave();if(e.key==='Escape')setEdit(null);}} />
          <button onClick={onSave} style={{marginLeft:'4px',fontSize:'11px',background:'var(--primary-container)',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 7px',cursor:'pointer'}}>✓</button>
          <button onClick={()=>setEdit(null)} style={{marginLeft:'3px',fontSize:'11px',background:'transparent',border:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button>
        </span>
      ) : (
        <span>{label} <button onClick={()=>setEdit({id:editState?.id, val:''})} style={{fontSize:'10px',background:'transparent',border:'none',color:'var(--text-muted)',cursor:'pointer',padding:'0 3px',verticalAlign:'middle'}}>✎</button></span>
      );

      return (
        <div>
          <div className="mod-header">
            <div>
              <div className="mod-title">Marketing Analitika</div>
              <div className="mod-sub">Facebook Ads kampaniyalar va Telegram kanal boshqaruvi</div>
            </div>
            <button className="btn-primary" onClick={()=>setShowNew(!showNew)}><Ico n="plus" s={14}/> Yangi Kampaniya</button>
          </div>

          {/* Yangi kampaniya formasi */}
          {showNew && (
            <div className="card" style={{marginBottom:'16px', background:'rgba(24,119,242,0.04)', border:'1px solid rgba(24,119,242,0.25)'}}>
              <div style={{fontWeight:600, fontSize:'14px', marginBottom:'14px', color:'#1877F2'}}>Yangi Facebook Kampaniya</div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:'10px', alignItems:'end'}}>
                <div>
                  <span className="label-sm">Kampaniya nomi</span>
                  <input className="input-base" style={{marginBottom:0}} placeholder="Yoz aksiyasi..." value={newC.name} onChange={e=>setNewC({...newC,name:e.target.value})} />
                </div>
                <div>
                  <span className="label-sm">Byudjet (so'm)</span>
                  <input type="number" className="input-base" style={{marginBottom:0}} placeholder="1000000" value={newC.budget} onChange={e=>setNewC({...newC,budget:e.target.value})} />
                </div>
                <div>
                  <span className="label-sm">Qamrov (taxmin)</span>
                  <input type="number" className="input-base" style={{marginBottom:0}} placeholder="10000" value={newC.reach} onChange={e=>setNewC({...newC,reach:e.target.value})} />
                </div>
                <div style={{display:'flex', gap:'8px', paddingBottom:'1px'}}>
                  <button className="btn-primary" onClick={addCampaign}>Qo'shish</button>
                  <button className="btn-outline" onClick={()=>setShowNew(false)}>✕</button>
                </div>
              </div>
            </div>
          )}

          {/* Umumiy statistika */}
          <div className="stat-mini-grid">
            {[
              {label:"Faol kampaniyalar", val:actCount,         color:'#01a750'},
              {label:"Jami leadlar",       val:totLeads,         color:'var(--text-main)'},
              {label:"Sarflandi",          val:fmtSum(totSpent), color:'#f59e0b'},
              {label:"O'rtacha CPL",       val:fmtSum(avgCPL),  color:'#3b82f6'},
            ].map((m,i) => (
              <div key={i} className="stat-mini">
                <div className="stat-mini-label">{m.label}</div>
                <div className="stat-mini-value" style={{color:m.color, fontSize:i>=2?'16px':'26px', lineHeight:i>=2?1.4:1, marginTop:i>=2?'4px':0}}>{m.val}</div>
              </div>
            ))}
          </div>

          {/* ── Facebook Ads ── */}
          <div style={{marginBottom:'24px'}}>
            <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'14px'}}>
              <div style={{width:'32px', height:'32px', background:'#1877F2', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center'}}>
                <span style={{color:'#fff', fontWeight:900, fontSize:'15px', fontFamily:'Georgia,serif'}}>f</span>
              </div>
              <h3 style={{fontSize:'15px', fontWeight:700}}>Facebook Ads Kampaniyalar</h3>
              <span style={{fontSize:'11px', color:'var(--text-muted)', marginLeft:'auto'}}>{campaigns.length} ta kampaniya</span>
            </div>

            {campaigns.length === 0 ? (
              <div className="card" style={{textAlign:'center', padding:'40px', color:'var(--text-muted)'}}>
                <span className="material-symbols-outlined" style={{fontSize:'40px', opacity:0.3, display:'block', marginBottom:'10px'}}>campaign</span>
                Kampaniya yo'q. "Yangi Kampaniya" tugmasini bosing.
              </div>
            ) : (
              <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                {campaigns.map(c => {
                  const pct = c.budget > 0 ? Math.min(100, Math.round(c.spent/c.budget*100)) : 0;
                  return (
                    <div key={c.id} className="card" style={{padding:'16px 20px'}}>
                      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'14px'}}>
                        <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                          <span style={{fontWeight:700, fontSize:'14px'}}>{c.name}</span>
                          <span style={{padding:'3px 9px', borderRadius:'20px', fontSize:'10px', fontWeight:700, textTransform:'uppercase',
                            background:c.status==='active'?'rgba(1,167,80,0.12)':'rgba(245,158,11,0.1)',
                            color:c.status==='active'?'#01a750':'#f59e0b',
                            border:`1px solid ${c.status==='active'?'rgba(1,167,80,0.3)':'rgba(245,158,11,0.3)'}`}}>
                            {c.status==='active'?'Faol':"To'xtatildi"}
                          </span>
                        </div>
                        <div style={{display:'flex', gap:'6px'}}>
                          <button className="btn-outline" style={{padding:'5px 12px', fontSize:'11px'}} onClick={()=>toggleStatus(c.id)}>
                            {c.status==='active'?"To'xtatish":'Ishga tushirish'}
                          </button>
                          <button className="btn-danger" style={{padding:'5px 9px', fontSize:'12px'}} onClick={()=>deleteCamp(c.id)}>✕</button>
                        </div>
                      </div>

                      {/* Metrikalar */}
                      <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'10px', marginBottom:'12px'}}>
                        {[
                          {label:'Leadlar',  val:c.leads,           color:'var(--accent)'},
                          {label:'CPL',      val:fmtSum(c.cpl),     color:'var(--text-main)'},
                          {label:'Qamrov',   val:fmt(c.reach),      color:'#3b82f6'},
                          {label:'Byudjet %',val:pct+'%',           color:pct>=90?'#ef4444':pct>=70?'#f59e0b':'#01a750'},
                        ].map((s,i) => (
                          <div key={i} style={{textAlign:'center', padding:'9px', background:'var(--bg-base)', borderRadius:'7px', border:'1px solid var(--border-light)'}}>
                            <div style={{fontSize:'16px', fontWeight:700, color:s.color}}>{s.val}</div>
                            <div style={{fontSize:'10px', color:'var(--text-muted)', marginTop:'2px', textTransform:'uppercase', letterSpacing:'0.05em'}}>{s.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Byudjet va sarfni inline tahrirlash */}
                      <div>
                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'5px', flexWrap:'wrap', gap:'4px'}}>
                          <span style={{fontSize:'11px', color:'var(--text-muted)'}}>
                            Sarflandi:{' '}
                            {editSpent?.id===c.id ? (
                              <span>
                                <input type="number" autoFocus style={{background:'var(--surface-variant)',border:'1px solid var(--border-hover)',borderRadius:'4px',padding:'1px 6px',color:'var(--text-main)',fontSize:'11px',width:'100px'}}
                                  value={editSpent.val} onChange={e=>setEditSpent({...editSpent,val:e.target.value})}
                                  onKeyDown={e=>{if(e.key==='Enter')saveSpent();if(e.key==='Escape')setEditSpent(null);}} />
                                <button onClick={saveSpent} style={{marginLeft:'4px',fontSize:'11px',background:'var(--primary-container)',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 7px',cursor:'pointer'}}>✓</button>
                                <button onClick={()=>setEditSpent(null)} style={{marginLeft:'3px',fontSize:'11px',background:'transparent',border:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button>
                              </span>
                            ) : (
                              <span>{fmtSum(c.spent)} <button onClick={()=>setEditSpent({id:c.id,val:c.spent})} style={{fontSize:'10px',background:'transparent',border:'none',color:'var(--text-muted)',cursor:'pointer',padding:'0 3px',verticalAlign:'middle'}}>✎</button></span>
                            )}
                            {' / '}
                            {editBudget?.id===c.id ? (
                              <span>
                                <input type="number" autoFocus style={{background:'var(--surface-variant)',border:'1px solid var(--border-hover)',borderRadius:'4px',padding:'1px 6px',color:'var(--text-main)',fontSize:'11px',width:'100px'}}
                                  value={editBudget.val} onChange={e=>setEditBudget({...editBudget,val:e.target.value})}
                                  onKeyDown={e=>{if(e.key==='Enter')saveBudget();if(e.key==='Escape')setEditBudget(null);}} />
                                <button onClick={saveBudget} style={{marginLeft:'4px',fontSize:'11px',background:'var(--primary-container)',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 7px',cursor:'pointer'}}>✓</button>
                                <button onClick={()=>setEditBudget(null)} style={{marginLeft:'3px',fontSize:'11px',background:'transparent',border:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button>
                              </span>
                            ) : (
                              <span>{fmtSum(c.budget)} <button onClick={()=>setEditBudget({id:c.id,val:c.budget})} style={{fontSize:'10px',background:'transparent',border:'none',color:'var(--text-muted)',cursor:'pointer',padding:'0 3px',verticalAlign:'middle'}}>✎</button></span>
                            )}
                            {' | Leadlar: '}
                            {editLeads?.id===c.id ? (
                              <span>
                                <input type="number" autoFocus style={{background:'var(--surface-variant)',border:'1px solid var(--border-hover)',borderRadius:'4px',padding:'1px 6px',color:'var(--text-main)',fontSize:'11px',width:'70px'}}
                                  value={editLeads.val} onChange={e=>setEditLeads({...editLeads,val:e.target.value})}
                                  onKeyDown={e=>{if(e.key==='Enter')saveLeads();if(e.key==='Escape')setEditLeads(null);}} />
                                <button onClick={saveLeads} style={{marginLeft:'4px',fontSize:'11px',background:'var(--primary-container)',color:'#fff',border:'none',borderRadius:'4px',padding:'2px 7px',cursor:'pointer'}}>✓</button>
                                <button onClick={()=>setEditLeads(null)} style={{marginLeft:'3px',fontSize:'11px',background:'transparent',border:'none',color:'var(--text-muted)',cursor:'pointer'}}>✕</button>
                              </span>
                            ) : (
                              <span>{c.leads} <button onClick={()=>setEditLeads({id:c.id,val:c.leads})} style={{fontSize:'10px',background:'transparent',border:'none',color:'var(--text-muted)',cursor:'pointer',padding:'0 3px',verticalAlign:'middle'}}>✎</button></span>
                            )}
                          </span>
                          <span style={{fontSize:'11px', fontWeight:700, color:pct>=90?'#ef4444':pct>=70?'#f59e0b':'var(--text-muted)'}}>{pct}%</span>
                        </div>
                        <div className="budget-bar" style={{height:'6px'}}>
                          <div className="budget-bar-fill" style={{width:pct+'%', background:pct>=90?'#ef4444':pct>=70?'#f59e0b':'#1877F2', transition:'width 0.4s ease'}}></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Telegram Kanallar ── */}
          <div>
            <div style={{display:'flex', alignItems:'center', gap:'10px', marginBottom:'14px'}}>
              <div style={{width:'32px', height:'32px', background:'#0088cc', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center'}}>
                <span className="material-symbols-outlined" style={{fontSize:'16px', color:'#fff'}}>send</span>
              </div>
              <h3 style={{fontSize:'15px', fontWeight:700}}>Telegram Kanallar</h3>
              <button className="btn-outline" style={{marginLeft:'auto', padding:'5px 12px', fontSize:'12px'}} onClick={()=>setShowNewTg(!showNewTg)}>
                <Ico n="plus" s={13}/> Kanal qo'shish
              </button>
            </div>

            {/* Yangi kanal formasi */}
            {showNewTg && (
              <div className="card" style={{marginBottom:'14px', background:'rgba(0,136,204,0.04)', border:'1px solid rgba(0,136,204,0.25)'}}>
                <div style={{fontWeight:600, fontSize:'13px', marginBottom:'12px', color:'#0088cc'}}>Yangi Telegram Kanal</div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'10px'}}>
                  <div>
                    <span className="label-sm">Kanal nomi</span>
                    <input className="input-base" style={{marginBottom:0}} placeholder="@kompaniya_uz" value={newTg.name} onChange={e=>setNewTg({...newTg,name:e.target.value})} />
                  </div>
                  <div>
                    <span className="label-sm">Obunachi soni</span>
                    <input type="number" className="input-base" style={{marginBottom:0}} placeholder="5000" value={newTg.subscribers} onChange={e=>setNewTg({...newTg,subscribers:e.target.value})} />
                  </div>
                  <div>
                    <span className="label-sm">Bu oy qo'shildi</span>
                    <input className="input-base" style={{marginBottom:0}} placeholder="+120 bu oy" value={newTg.joinRate} onChange={e=>setNewTg({...newTg,joinRate:e.target.value})} />
                  </div>
                  <div>
                    <span className="label-sm">Postlar soni</span>
                    <input type="number" className="input-base" style={{marginBottom:0}} placeholder="20" value={newTg.posts} onChange={e=>setNewTg({...newTg,posts:e.target.value})} />
                  </div>
                  <div>
                    <span className="label-sm">Qamrov</span>
                    <input type="number" className="input-base" style={{marginBottom:0}} placeholder="15000" value={newTg.reach} onChange={e=>setNewTg({...newTg,reach:e.target.value})} />
                  </div>
                  <div>
                    <span className="label-sm">Kliklar</span>
                    <input type="number" className="input-base" style={{marginBottom:0}} placeholder="800" value={newTg.clicks} onChange={e=>setNewTg({...newTg,clicks:e.target.value})} />
                  </div>
                </div>
                <div style={{display:'flex', gap:'8px'}}>
                  <button className="btn-primary" onClick={addTgChannel}>Saqlash</button>
                  <button className="btn-outline" onClick={()=>setShowNewTg(false)}>Bekor</button>
                </div>
              </div>
            )}

            {/* Tahrirlash modali */}
            {editTg && (
              <div className="login-overlay">
                <div className="modal-box" style={{maxWidth:'480px'}}>
                  <div style={{fontWeight:700, fontSize:'15px', marginBottom:'16px'}}>Kanalni tahrirlash</div>
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'14px'}}>
                    {[
                      {label:'Kanal nomi',    key:'name',        type:'text',   ph:'@kanal_uz'},
                      {label:'Obunachi',      key:'subscribers', type:'number', ph:'5000'},
                      {label:'Bu oy (+/-)',   key:'joinRate',    type:'text',   ph:'+120 bu oy'},
                      {label:'Postlar',       key:'posts',       type:'number', ph:'20'},
                      {label:'Qamrov',        key:'reach',       type:'number', ph:'15000'},
                      {label:'Kliklar',       key:'clicks',      type:'number', ph:'800'},
                    ].map(f=>(
                      <div key={f.key}>
                        <span className="label-sm">{f.label}</span>
                        <input type={f.type} className="input-base" style={{marginBottom:0}} placeholder={f.ph} value={editTg[f.key]||''} onChange={e=>setEditTg({...editTg,[f.key]:e.target.value})} />
                      </div>
                    ))}
                  </div>
                  <div style={{display:'flex', gap:'8px'}}>
                    <button className="btn-primary" onClick={saveTgEdit}>Saqlash</button>
                    <button className="btn-outline" onClick={()=>setEditTg(null)}>Bekor</button>
                  </div>
                </div>
              </div>
            )}

            {tgChannels.length === 0 ? (
              <div className="card" style={{textAlign:'center', padding:'40px', color:'var(--text-muted)'}}>
                <span className="material-symbols-outlined" style={{fontSize:'40px', opacity:0.3, display:'block', marginBottom:'10px'}}>send</span>
                Telegram kanal qo'shilmagan. "Kanal qo'shish" tugmasini bosing.
              </div>
            ) : (
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px'}}>
                {tgChannels.map(ch => (
                  <div key={ch.id} className="card">
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'16px'}}>
                      <div>
                        <div style={{fontWeight:700, fontSize:'15px', color:'#0088cc'}}>{ch.name}</div>
                        {ch.joinRate && <div style={{fontSize:'11px', color:'#01a750', marginTop:'3px', fontWeight:600}}>{ch.joinRate}</div>}
                      </div>
                      <div style={{display:'flex', gap:'6px', alignItems:'center'}}>
                        <span style={{background:'rgba(0,136,204,0.12)', color:'#0088cc', padding:'3px 10px', borderRadius:'20px', fontSize:'10px', fontWeight:700, border:'1px solid rgba(0,136,204,0.3)'}}>FAOL</span>
                        <button className="btn-outline" style={{padding:'4px 8px', fontSize:'11px'}} onClick={()=>setEditTg({...ch})}>✎</button>
                        <button className="btn-danger" style={{padding:'4px 8px', fontSize:'11px'}} onClick={()=>deleteTg(ch.id)}>✕</button>
                      </div>
                    </div>
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px'}}>
                      {[
                        {label:'Obunachi', val:fmt(ch.subscribers), color:'var(--text-main)', icon:'group'},
                        {label:'Postlar',  val:ch.posts,            color:'var(--text-main)', icon:'article'},
                        {label:'Qamrov',   val:fmt(ch.reach),       color:'#0088cc',          icon:'visibility'},
                        {label:'Kliklar',  val:fmt(ch.clicks),      color:'#01a750',          icon:'ads_click'},
                      ].map((s,i) => (
                        <div key={i} style={{padding:'12px', background:'var(--bg-base)', borderRadius:'8px', border:'1px solid var(--border-light)', display:'flex', alignItems:'center', gap:'10px'}}>
                          <span className="material-symbols-outlined" style={{fontSize:'18px', color:s.color, opacity:0.7}}>{s.icon}</span>
                          <div>
                            <div style={{fontSize:'18px', fontWeight:700, color:s.color, lineHeight:1}}>{s.val}</div>
                            <div style={{fontSize:'10px', color:'var(--text-muted)', marginTop:'2px', textTransform:'uppercase', letterSpacing:'0.05em'}}>{s.label}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    };

    // ===== SUPER ADMIN PANEL =====
    const SuperAdminPanel = ({ authUser, onLogout }) => {
      const [companies,    setCompanies]    = useState([]);
      const [loading,      setLoading]      = useState(true);
      const [view,         setView]         = useState(() => localStorage.getItem('sa_view') || 'list');
      const [selCompany,   setSelCompany]   = useState(null);
      const [compUsers,    setCompUsers]    = useState([]);
      const [showAddUser,  setShowAddUser]  = useState(false);
      const [createForm,   setCreateForm]   = useState({name:'', slug:'', plan:'basic', call_limit:5, admin_username:'', admin_password:'', admin_email:''});
      const [userForm,     setUserForm]     = useState({username:'', password:'', role:'MANAGER', full_name:'', email:''});
      const [msg,          setMsg]          = useState('');
      const [saving,       setSaving]       = useState(false);
      const [lastCreated,  setLastCreated]  = useState(null);
      const [copiedSlug,   setCopiedSlug]   = useState(null);
      const [editUserModal, setEditUserModal] = useState(null);
      const [editUserForm,  setEditUserForm]  = useState({username:'', password:'', role:'MANAGER', full_name:''});
      // Task 4: Settings tab — parol o'zgartirish
      const [saView,        setSaView]        = useState('companies'); // 'companies' | 'settings'
      const [passForm,      setPassForm]      = useState({currentPassword:'', newPassword:'', confirmPassword:'', keyword:''});
      const [passSaving,    setPassSaving]    = useState(false);
      // Task 5: Company edit modal
      const [editCompModal, setEditCompModal] = useState(null); // null | companyObj
      const [editCompForm,  setEditCompForm]  = useState({name:'', slug:'', plan:'basic', call_limit:5, email:''});
      const [editCompSaving, setEditCompSaving] = useState(false);

      const token = localStorage.getItem('mizon_token');
      const H = {'Content-Type':'application/json','Authorization':'Bearer '+token};

      const flash = (m) => { setMsg(m); setTimeout(()=>setMsg(''), 4000); };

      const MAIN_DOMAIN = 'mizon-crm.uz';
      const companyUrl = (slug) => `https://${slug}.${MAIN_DOMAIN}`;

      const copyUrl = (slug) => {
        const url = companyUrl(slug);
        const done = () => { setCopiedSlug(slug); setTimeout(()=>setCopiedSlug(null), 2200); };
        if (navigator.clipboard) { navigator.clipboard.writeText(url).then(done).catch(done); }
        else { try { const el=document.createElement('textarea'); el.value=url; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el); } catch{} done(); }
      };

      // view va selCompany ni localStorage ga saqlash
      useEffect(() => {
        localStorage.setItem('sa_view', view);
        if (view === 'list') localStorage.removeItem('sa_selCompanyId');
      }, [view]);
      useEffect(() => {
        if (selCompany?.id) localStorage.setItem('sa_selCompanyId', String(selCompany.id));
      }, [selCompany]);

      const loadCompanyUsers = async (comp) => {
        const r = await fetch(`/api/superadmin/companies/${comp.id}/users`, {headers:H});
        setCompUsers(await r.json());
      };

      const loadCompanies = async (restoreState = false) => {
        setLoading(true);
        try {
          const r = await fetch('/api/superadmin/companies', {headers:H});
          const d = await r.json();
          const list = Array.isArray(d) ? d : [];
          setCompanies(list);
          // Refresh dan keyin oldingi view ni tiklash
          if (restoreState) {
            const savedView = localStorage.getItem('sa_view') || 'list';
            const savedId   = localStorage.getItem('sa_selCompanyId');
            if (savedView === 'detail' && savedId) {
              const comp = list.find(c => String(c.id) === savedId);
              if (comp) {
                setSelCompany(comp); setView('detail');
                const ru = await fetch(`/api/superadmin/companies/${comp.id}/users`, {headers:H});
                setCompUsers(await ru.json());
              } else { setView('list'); }
            } else if (savedView === 'create') {
              setView('create');
            }
          }
        } catch(e) { flash('Xato: '+e.message); }
        setLoading(false);
      };

      useEffect(() => { loadCompanies(true); }, []);

      // ── Refs: ESC / back-button uchun joriy state ────────────────
      const saRefs = useRef({ view: 'list', showAddUser: false, editUserModal: null });
      useEffect(() => { saRefs.current = { view, showAddUser, editUserModal }; }, [view, showAddUser, editUserModal]);

      // ── Orqaga tugmasi ───────────────────────────────────────────
      useEffect(() => {
        history.pushState({ mizonSA: true }, '', window.location.href);
        const onPop = () => {
          history.pushState({ mizonSA: true }, '', window.location.href);
          const s = saRefs.current;
          if (s.editUserModal)  { setEditUserModal(null); }
          else if (s.showAddUser) { setShowAddUser(false); }
          else if (s.view !== 'list') { setView('list'); }
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
      }, []);

      // ── ESC tugmasi ──────────────────────────────────────────────
      useEffect(() => {
        const onKey = (e) => {
          if (e.key !== 'Escape') return;
          if (editUserModal)  { setEditUserModal(null); return; }
          if (showAddUser)    { setShowAddUser(false);  return; }
          if (view !== 'list') { setView('list');       return; }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [view, showAddUser, editUserModal]);

      const createCompany = async (e) => {
        e.preventDefault(); setSaving(true);
        const r = await fetch('/api/superadmin/companies', {method:'POST', headers:H, body:JSON.stringify(createForm)});
        const d = await r.json(); setSaving(false);
        if (!r.ok) return flash('❌ '+d.error);
        setLastCreated({
          ...(d.company || {name:createForm.name, slug:createForm.slug}),
          admin_username: createForm.admin_username,
          admin_email: createForm.admin_email,
        });
        setView('list'); loadCompanies();
        setCreateForm({name:'', slug:'', plan:'basic', call_limit:5, admin_username:'', admin_password:'', admin_email:''});
      };

      const toggleActive = async (comp) => {
        await fetch(`/api/superadmin/companies/${comp.id}`, {method:'PUT', headers:H, body:JSON.stringify({is_active:!comp.is_active})});
        loadCompanies();
        if (selCompany?.id === comp.id) setSelCompany({...selCompany, is_active:!comp.is_active});
      };

      const deleteCompany = async (comp) => {
        // Task 3: Kalit so'z tekshiruvi
        const keyword = window.prompt(
          `⚠️ "${comp.name}" kompaniyasini O'CHIRISH uchun kalit so'zni kiriting:\n\n` +
          `Bu amalni bekor qilib bo'lmaydi. Barcha leadlar, xodimlar va ma'lumotlar o'chib ketadi!\n\n` +
          `Kalit so'z:`
        );
        if (!keyword) return; // Bekor qilindi
        if (keyword.trim() !== 'tizim') {
          alert('❌ Noto\'g\'ri kalit so\'z. O\'chirish bekor qilindi.');
          return;
        }
        const r = await fetch(`/api/superadmin/companies/${comp.id}`, {
          method:'DELETE', headers:{...H, 'Content-Type':'application/json'},
          body: JSON.stringify({ keyword: 'tizim' }),
        });
        const d = await r.json();
        if (!r.ok) { flash('❌ ' + d.error); return; }
        flash('✅ Kompaniya o\'chirildi');
        loadCompanies(); setView('list');
      };

      const openDetail = async (comp) => {
        setSelCompany(comp); setView('detail');
        await loadCompanyUsers(comp);
      };

      const addUser = async (e) => {
        e.preventDefault(); setSaving(true);
        const r = await fetch(`/api/superadmin/companies/${selCompany.id}/users`, {method:'POST', headers:H, body:JSON.stringify(userForm)});
        const d = await r.json(); setSaving(false);
        if (!r.ok) return flash('❌ '+d.error);
        setShowAddUser(false); setUserForm({username:'', password:'', role:'MANAGER', full_name:''});
        loadCompanyUsers(selCompany);
      };

      const deleteUser = async (uid) => {
        if (!window.confirm("Foydalanuvchini o'chirish?")) return;
        await fetch(`/api/superadmin/users/${uid}`, {method:'DELETE', headers:H});
        loadCompanyUsers(selCompany);
      };

      const openEditUser = (u) => {
        setEditUserForm({ username: u.username, password: '', role: u.role, full_name: u.full_name || '' });
        setEditUserModal(u);
      };

      const submitEditUser = async (e) => {
        e.preventDefault(); setSaving(true);
        const body = { role: editUserForm.role, full_name: editUserForm.full_name };
        if (editUserForm.username && editUserForm.username !== editUserModal.username) body.username = editUserForm.username;
        if (editUserForm.password) body.password = editUserForm.password;
        const r = await fetch(`/api/superadmin/users/${editUserModal.id}`, {method:'PUT', headers:H, body:JSON.stringify(body)});
        const d = await r.json(); setSaving(false);
        if (!r.ok) return flash('❌ ' + d.error);
        flash('✅ Foydalanuvchi yangilandi');
        setEditUserModal(null);
        loadCompanyUsers(selCompany);
      };

      // Task 4: SA parol o'zgartirish
      const changePassword = async (e) => {
        e.preventDefault();
        if (passForm.newPassword !== passForm.confirmPassword)
          return flash('❌ Yangi parollar mos kelmadi');
        if (passForm.keyword !== 'tizim')
          return flash('❌ Noto\'g\'ri kalit so\'z');
        setPassSaving(true);
        const r = await fetch('/api/superadmin/password', {
          method:'PUT', headers:H,
          body: JSON.stringify({ currentPassword:passForm.currentPassword, newPassword:passForm.newPassword, keyword:passForm.keyword })
        });
        const d = await r.json(); setPassSaving(false);
        if (!r.ok) return flash('❌ ' + d.error);
        flash('✅ Parol muvaffaqiyatli o\'zgartirildi');
        setPassForm({currentPassword:'', newPassword:'', confirmPassword:'', keyword:''});
      };

      // Task 5: Company tahrirlash
      const openEditComp = (comp) => {
        setEditCompForm({
          name: comp.name || '',
          slug: comp.slug || '',
          plan: comp.plan || 'basic',
          call_limit: comp.call_limit || 5,
          email: comp.email || '',
        });
        setEditCompModal(comp);
      };
      const submitEditComp = async (e) => {
        e.preventDefault(); setEditCompSaving(true);
        const r = await fetch(`/api/superadmin/companies/${editCompModal.id}`, {
          method:'PUT', headers:{...H, 'Content-Type':'application/json'},
          body: JSON.stringify(editCompForm),
        });
        const d = await r.json(); setEditCompSaving(false);
        if (!r.ok) return flash('❌ ' + d.error);
        flash('✅ Kompaniya ma\'lumotlari yangilandi');
        setEditCompModal(null);
        loadCompanies(true);
      };

      const planBadge = (plan) => ({basic:'#3b82f6', pro:'#8b5cf6', enterprise:'#f59e0b'}[plan]||'#6b7280');

      return (
        <div style={{minHeight:'100vh', background:'var(--bg-base)', fontFamily:'var(--font-body)'}}>
          {/* Header */}
          <div style={{background:'var(--bg-surface)', borderBottom:'1px solid var(--outline-variant)', padding:'0 28px', display:'flex', alignItems:'center', justifyContent:'space-between', height:'56px', flexShrink:0}}>
            <div style={{display:'flex', alignItems:'center', gap:'14px'}}>
              <div style={{width:'32px', height:'32px', background:'linear-gradient(135deg,#6366f1,#4f46e5)', borderRadius:'8px', display:'flex', alignItems:'center', justifyContent:'center'}}>
                <span style={{fontSize:'14px', fontWeight:800, color:'#fff'}}>S</span>
              </div>
              <div>
                <div style={{fontWeight:700, fontSize:'15px', letterSpacing:'-0.3px'}}>Mizon Super Admin</div>
                <div style={{fontSize:'11px', color:'var(--text-muted)'}}>Platforma boshqaruvi</div>
              </div>
            </div>
            <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
              {view !== 'list' && <button className="btn-outline" style={{padding:'6px 14px', fontSize:'12px'}} onClick={()=>setView('list')}>← Orqaga</button>}
              {saView === 'companies' && <button className="btn-primary" style={{padding:'6px 14px', fontSize:'12px'}} onClick={()=>setView('create')}>+ Kompaniya qo'shish</button>}
              <button className={`btn-outline`} style={{padding:'6px 14px', fontSize:'12px'}} onClick={()=>setSaView(saView==='settings'?'companies':'settings')}>
                {saView==='settings' ? '← Kompaniyalar' : '⚙️ Sozlamalar'}
              </button>
              <button className="btn-outline" style={{padding:'6px 14px', fontSize:'12px'}} onClick={onLogout}>Chiqish</button>
            </div>
          </div>

          {/* Flash message */}
          {msg && <div style={{background:msg.startsWith('✅')?'rgba(1,167,80,0.12)':'rgba(239,68,68,0.1)', border:`1px solid ${msg.startsWith('✅')?'rgba(1,167,80,0.3)':'rgba(239,68,68,0.3)'}`, color:msg.startsWith('✅')?'#01a750':'#ef4444', padding:'12px 28px', fontSize:'13px'}}>{msg}</div>}

          <div style={{padding:'28px', maxWidth:'1100px', margin:'0 auto'}}>

            {/* ── SETTINGS VIEW (Task 4) ── */}
            {saView === 'settings' && (
              <div style={{maxWidth:'480px'}}>
                <div style={{fontWeight:700, fontSize:'18px', marginBottom:'20px'}}>⚙️ Super Admin Sozlamalari</div>
                <div className="card" style={{padding:'24px'}}>
                  <div style={{fontWeight:600, fontSize:'14px', marginBottom:'16px', borderBottom:'1px solid var(--outline-variant)', paddingBottom:'10px'}}>🔑 Parolni o'zgartirish</div>
                  <form onSubmit={changePassword} style={{display:'flex', flexDirection:'column', gap:'12px'}}>
                    <div>
                      <span className="label-sm">Joriy parol *</span>
                      <input className="input-base" type="password" placeholder="••••••••" value={passForm.currentPassword} onChange={e=>setPassForm({...passForm,currentPassword:e.target.value})} required />
                    </div>
                    <div>
                      <span className="label-sm">Yangi parol *</span>
                      <input className="input-base" type="password" placeholder="Kamida 6 ta belgi" value={passForm.newPassword} onChange={e=>setPassForm({...passForm,newPassword:e.target.value})} required minLength={6} />
                    </div>
                    <div>
                      <span className="label-sm">Yangi parolni tasdiqlang *</span>
                      <input className="input-base" type="password" placeholder="Yangi parolni qaytaring" value={passForm.confirmPassword} onChange={e=>setPassForm({...passForm,confirmPassword:e.target.value})} required />
                    </div>
                    <div>
                      <span className="label-sm">Kalit so'z * (tasdiqlash uchun)</span>
                      <input className="input-base" type="text" placeholder="Kalit so'zni kiriting" value={passForm.keyword} onChange={e=>setPassForm({...passForm,keyword:e.target.value})} required />
                      <div style={{fontSize:'11px', color:'var(--text-muted)', marginTop:'3px'}}>Amalning haqiqiyligini tasdiqlash uchun <b>"tizim"</b> deb kiriting</div>
                    </div>
                    <button className="btn-primary" type="submit" disabled={passSaving} style={{padding:'10px', marginTop:'4px'}}>
                      {passSaving ? 'Saqlanmoqda...' : '🔒 Parolni o\'zgartirish'}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* ── COMPANIES VIEWS (only when saView === 'companies') ── */}
            {saView === 'companies' && <>

            {/* ── CREATE VIEW ── */}
            {view === 'create' && (
              <div>
                <div style={{fontWeight:700, fontSize:'18px', marginBottom:'20px'}}>Yangi kompaniya yaratish</div>
                <form onSubmit={createCompany} style={{background:'var(--bg-surface)', border:'1px solid var(--outline-variant)', borderRadius:'14px', padding:'24px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px'}}>
                  <div style={{gridColumn:'1/-1', fontWeight:600, fontSize:'13px', color:'var(--text-secondary)', borderBottom:'1px solid var(--outline-variant)', paddingBottom:'10px', marginBottom:'4px'}}>Kompaniya ma'lumotlari</div>
                  <div>
                    <span className="label-sm">Kompaniya nomi *</span>
                    <input className="input-base" placeholder="Avtosalon Tashkent" value={createForm.name} onChange={e=>setCreateForm({...createForm,name:e.target.value})} required />
                  </div>
                  <div>
                    <span className="label-sm">URL Slug * (lotin harflar, tire)</span>
                    <input className="input-base" placeholder="avtosalon-tashkent" value={createForm.slug}
                      onChange={e=>setCreateForm({...createForm,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')})} required />
                    {createForm.slug && <div style={{fontSize:'11px', color:'var(--text-muted)', marginTop:'4px'}}>Mijoz URL: <b style={{color:'var(--primary)'}}>{createForm.slug}.{MAIN_DOMAIN}</b></div>}
                  </div>
                  <div>
                    <span className="label-sm">Tarif rejasi</span>
                    <select className="input-base" value={createForm.plan} onChange={e=>setCreateForm({...createForm,plan:e.target.value})}>
                      <option value="basic">Basic (bepul)</option>
                      <option value="pro">Pro</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </div>
                  <div>
                    <span className="label-sm">Qo'ng'iroq limiti</span>
                    <input className="input-base" type="number" min="1" max="50" value={createForm.call_limit} onChange={e=>setCreateForm({...createForm,call_limit:parseInt(e.target.value)||5})} />
                  </div>
                  <div style={{gridColumn:'1/-1', fontWeight:600, fontSize:'13px', color:'var(--text-secondary)', borderBottom:'1px solid var(--outline-variant)', paddingBottom:'10px', marginTop:'6px', marginBottom:'4px'}}>CEO (admin) akkaunti</div>
                  <div>
                    <span className="label-sm">CEO username *</span>
                    <input className="input-base" placeholder="ceo_avtosalon" value={createForm.admin_username} onChange={e=>setCreateForm({...createForm,admin_username:e.target.value})} required />
                  </div>
                  <div>
                    <span className="label-sm">CEO paroli *</span>
                    <input className="input-base" type="password" placeholder="Xavfsiz parol" value={createForm.admin_password} onChange={e=>setCreateForm({...createForm,admin_password:e.target.value})} required />
                  </div>
                  <div>
                    <span className="label-sm">CEO Email (ixtiyoriy — email orqali login)</span>
                    <input className="input-base" type="email" placeholder="ceo@kompaniya.uz" value={createForm.admin_email||''} onChange={e=>setCreateForm({...createForm,admin_email:e.target.value})} />
                  </div>
                  <div style={{gridColumn:'1/-1', display:'flex', gap:'10px', marginTop:'6px'}}>
                    <button className="btn-primary" type="submit" disabled={saving} style={{padding:'10px 24px'}}>{saving?'Yaratilmoqda...':'Kompaniya yaratish'}</button>
                    <button className="btn-outline" type="button" onClick={()=>setView('list')} style={{padding:'10px 24px'}}>Bekor qilish</button>
                  </div>
                </form>
              </div>
            )}

            {/* ── DETAIL VIEW ── */}
            {view === 'detail' && selCompany && (
              <div>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'20px', flexWrap:'wrap', gap:'12px'}}>
                  <div>
                    <div style={{fontWeight:700, fontSize:'20px'}}>{selCompany.name}</div>
                    <div style={{fontSize:'13px', color:'var(--text-muted)', marginTop:'6px', display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap'}}>
                      <code style={{background:'var(--surface-variant)', padding:'3px 10px', borderRadius:'5px', fontSize:'12px', color:'var(--text-main)'}}>{companyUrl(selCompany.slug)}</code>
                      <button onClick={()=>copyUrl(selCompany.slug)} style={{padding:'3px 12px', fontSize:'11px', fontWeight:700, background: copiedSlug===selCompany.slug?'#059669':'var(--primary)', color:'white', border:'none', borderRadius:'5px', cursor:'pointer', transition:'background 0.2s', whiteSpace:'nowrap'}}>
                        {copiedSlug===selCompany.slug ? '✓ Nusxalandi!' : '📋 Nusxalash'}
                      </button>
                      <span style={{padding:'2px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:700, background:`${planBadge(selCompany.plan)}22`, color:planBadge(selCompany.plan)}}>{selCompany.plan?.toUpperCase()}</span>
                    </div>
                  </div>
                  <div style={{display:'flex', gap:'8px'}}>
                    <button className="btn-outline" style={{padding:'7px 14px', fontSize:'12px'}} onClick={()=>openEditComp(selCompany)}>✏️ Tahrirlash</button>
                    <button className={selCompany.is_active ? 'btn-outline' : 'btn-primary'} style={{padding:'7px 14px', fontSize:'12px'}} onClick={()=>toggleActive(selCompany)}>
                      {selCompany.is_active ? '⛔ Bloklash' : '✅ Faollashtirish'}
                    </button>
                    <button className="btn-danger" style={{padding:'7px 14px', fontSize:'12px'}} onClick={()=>deleteCompany(selCompany)}>O'chirish</button>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', marginBottom:'22px'}}>
                  {[
                    {label:'Xodimlar', val:compUsers.length, color:'var(--primary)'},
                    {label:'Qo\'ng\'iroq limiti', val:selCompany.call_limit, color:'#3b82f6'},
                    {label:'Holat', val:selCompany.is_active?'Faol':'Bloklangan', color:selCompany.is_active?'#01a750':'#ef4444'},
                  ].map((s,i) => (
                    <div key={i} className="stat-mini">
                      <div className="stat-mini-label">{s.label}</div>
                      <div className="stat-mini-value" style={{color:s.color, fontSize:'20px'}}>{s.val}</div>
                    </div>
                  ))}
                </div>

                {/* Users */}
                <div className="card" style={{padding:0, overflow:'hidden'}}>
                  <div style={{padding:'14px 20px', borderBottom:'1px solid var(--outline-variant)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <span style={{fontWeight:600, fontSize:'14px'}}>Xodimlar ({compUsers.length})</span>
                    <button className="btn-primary" style={{padding:'6px 14px', fontSize:'12px'}} onClick={()=>setShowAddUser(!showAddUser)}>+ Xodim qo'shish</button>
                  </div>
                  {showAddUser && (
                    <form onSubmit={addUser} style={{padding:'16px 20px', background:'rgba(1,167,80,0.04)', borderBottom:'1px solid var(--outline-variant)', display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr auto', gap:'10px', alignItems:'end'}}>
                      <div><span className="label-sm">Username *</span><input className="input-base" style={{marginBottom:0}} placeholder="menejer_2" value={userForm.username} onChange={e=>setUserForm({...userForm,username:e.target.value})} required /></div>
                      <div><span className="label-sm">Email (login uchun)</span><input className="input-base" style={{marginBottom:0}} type="email" placeholder="user@mail.uz" value={userForm.email||''} onChange={e=>setUserForm({...userForm,email:e.target.value})} /></div>
                      <div><span className="label-sm">Parol *</span><input className="input-base" style={{marginBottom:0}} type="password" placeholder="••••••" value={userForm.password} onChange={e=>setUserForm({...userForm,password:e.target.value})} required /></div>
                      <div><span className="label-sm">Rol</span>
                        <select className="input-base" style={{marginBottom:0}} value={userForm.role} onChange={e=>setUserForm({...userForm,role:e.target.value})}>
                          <option value="MANAGER">MANAGER</option>
                          <option value="CEO">CEO</option>
                          <option value="WATCHER">KUZATUVCHI</option>
                        </select>
                      </div>
                      <div style={{display:'flex', gap:'6px', paddingBottom:'1px'}}>
                        <button className="btn-primary" type="submit" disabled={saving}>{saving?'...':'Qo\'shish'}</button>
                        <button className="btn-outline" type="button" onClick={()=>setShowAddUser(false)}>✕</button>
                      </div>
                    </form>
                  )}
                  <table><thead><tr><th>Username</th><th>Email</th><th>Rol</th><th>Qo'shilgan</th><th></th></tr></thead>
                    <tbody>
                      {compUsers.map(u => (
                        <tr key={u.id}>
                          <td style={{fontWeight:600}}><span className="avatar" style={{width:'24px',height:'24px',fontSize:'10px',display:'inline-flex',marginRight:'8px'}}>{u.username[0].toUpperCase()}</span>{u.username}{u.full_name&&u.full_name!==u.username&&<span style={{fontSize:'11px',color:'var(--text-muted)',marginLeft:'6px'}}>({u.full_name})</span>}</td>
                          <td style={{fontSize:'12px',color:'var(--text-muted)'}}>{u.email||<span style={{opacity:0.4}}>—</span>}</td>
                          <td><span style={{padding:'2px 8px',borderRadius:'20px',fontSize:'10px',fontWeight:700,background:u.role==='CEO'?'rgba(1,167,80,0.12)':'var(--surface-variant)',color:u.role==='CEO'?'#01a750':'var(--text-secondary)'}}>{u.role}</span></td>
                          <td style={{fontSize:'11px',color:'var(--text-muted)'}}>{new Date(u.created_at).toLocaleDateString()}</td>
                          <td style={{display:'flex',gap:'6px'}}>
                            <button className="btn-outline" style={{padding:'4px 10px',fontSize:'11px'}} onClick={()=>openEditUser(u)}>✏️ Tahrirlash</button>
                            <button className="btn-danger" style={{padding:'4px 10px',fontSize:'11px'}} onClick={()=>deleteUser(u.id)}>O'chirish</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── EDIT USER MODAL ── */}
            {editUserModal && (
              <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}} onClick={e=>{if(e.target===e.currentTarget)setEditUserModal(null);}}>
                <div style={{background:'var(--bg-surface)',borderRadius:'14px',width:'100%',maxWidth:'420px',boxShadow:'0 24px 64px rgba(0,0,0,0.5)'}}>
                  <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--outline-variant)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:'15px'}}>Foydalanuvchini tahrirlash</div>
                      <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'2px'}}>@{editUserModal.username}</div>
                    </div>
                    <button onClick={()=>setEditUserModal(null)} style={{background:'none',border:'none',fontSize:'18px',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
                  </div>
                  <form onSubmit={submitEditUser} style={{padding:'18px 22px'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                      <div style={{gridColumn:'1/-1'}}>
                        <span className="label-sm">Username</span>
                        <input className="input-base" style={{marginBottom:0}} placeholder={editUserModal.username} value={editUserForm.username} onChange={e=>setEditUserForm({...editUserForm,username:e.target.value})} />
                        <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'3px'}}>Bo'sh qoldirsangiz o'zgarmaydi</div>
                      </div>
                      <div style={{gridColumn:'1/-1'}}>
                        <span className="label-sm">To'liq ism</span>
                        <input className="input-base" style={{marginBottom:0}} placeholder="Ism Familiya" value={editUserForm.full_name} onChange={e=>setEditUserForm({...editUserForm,full_name:e.target.value})} />
                      </div>
                      <div>
                        <span className="label-sm">Yangi parol</span>
                        <input className="input-base" style={{marginBottom:0}} type="password" placeholder="Yangi parol (ixtiyoriy)" value={editUserForm.password} onChange={e=>setEditUserForm({...editUserForm,password:e.target.value})} />
                        <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'3px'}}>Bo'sh = o'zgarmaydi</div>
                      </div>
                      <div>
                        <span className="label-sm">Rol</span>
                        <select className="input-base" style={{marginBottom:0}} value={editUserForm.role} onChange={e=>setEditUserForm({...editUserForm,role:e.target.value})}>
                          <option value="MANAGER">MANAGER</option>
                          <option value="CEO">CEO</option>
                          <option value="WATCHER">KUZATUVCHI</option>
                        </select>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:'8px',marginTop:'16px'}}>
                      <button className="btn-primary" type="submit" disabled={saving} style={{flex:1,padding:'10px'}}>{saving?'Saqlanmoqda...':'💾 Saqlash'}</button>
                      <button className="btn-outline" type="button" style={{padding:'10px 16px'}} onClick={()=>setEditUserModal(null)}>Bekor</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* ── LIST VIEW ── */}
            {view === 'list' && (
              <div>
                {/* ── Last created URL card ── */}
                {lastCreated && (
                  <div style={{background:'#ecfdf5', border:'1px solid #6ee7b7', borderRadius:'10px', padding:'14px 18px', marginBottom:'20px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', flexWrap:'wrap'}}>
                    <div>
                      <div style={{fontWeight:700, color:'#065f46', fontSize:'13px', marginBottom:'8px'}}>✅ <b>{lastCreated.name}</b> muvaffaqiyatli yaratildi!</div>
                      <div style={{fontSize:'12px', color:'#065f46', marginBottom:'8px', display:'flex', flexDirection:'column', gap:'3px'}}>
                        <span>🌐 <b>Sayt:</b> <code style={{background:'white', border:'1px solid #a7f3d0', borderRadius:'4px', padding:'2px 8px'}}>mizon-crm.uz</code></span>
                        <span>👤 <b>Login:</b> <code style={{background:'white', border:'1px solid #a7f3d0', borderRadius:'4px', padding:'2px 8px'}}>{lastCreated.admin_username}</code></span>
                        {lastCreated.admin_email && <span>📧 <b>Email:</b> <code style={{background:'white', border:'1px solid #a7f3d0', borderRadius:'4px', padding:'2px 8px'}}>{lastCreated.admin_email}</code></span>}
                      </div>
                      <div style={{display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap'}}>
                        <code style={{background:'white', border:'1px solid #a7f3d0', borderRadius:'6px', padding:'5px 12px', fontSize:'13px', color:'#065f46', fontWeight:600, letterSpacing:'0.2px'}}>
                          {companyUrl(lastCreated.slug)}
                        </code>
                        <button onClick={()=>copyUrl(lastCreated.slug)} style={{padding:'5px 14px', fontSize:'12px', fontWeight:700, background: copiedSlug===lastCreated.slug?'#059669':'#10b981', color:'white', border:'none', borderRadius:'6px', cursor:'pointer', transition:'background 0.2s', whiteSpace:'nowrap'}}>
                          {copiedSlug===lastCreated.slug ? '✓ Nusxalandi!' : '📋 Nusxalash'}
                        </button>
                      </div>
                    </div>
                    <button onClick={()=>setLastCreated(null)} style={{background:'none', border:'none', fontSize:'18px', color:'#6ee7b7', cursor:'pointer', padding:'0 4px', lineHeight:1}}>✕</button>
                  </div>
                )}

                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px'}}>
                  <div style={{fontWeight:700, fontSize:'20px'}}>Kompaniyalar ({companies.length})</div>
                  <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'12px', width:'400px'}}>
                    {[
                      {label:'Jami', val:companies.length, color:'var(--text-main)'},
                      {label:'Faol', val:companies.filter(c=>c.is_active).length, color:'#01a750'},
                      {label:'Bloklangan', val:companies.filter(c=>!c.is_active).length, color:'#ef4444'},
                    ].map((s,i) => (
                      <div key={i} className="stat-mini" style={{padding:'10px 14px'}}>
                        <div className="stat-mini-label">{s.label}</div>
                        <div className="stat-mini-value" style={{color:s.color, fontSize:'20px'}}>{s.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {loading && <div style={{textAlign:'center',padding:'60px',color:'var(--text-muted)'}}>Yuklanmoqda...</div>}
                {!loading && companies.length === 0 && (
                  <div style={{textAlign:'center', padding:'60px', color:'var(--text-muted)'}}>
                    <div style={{fontSize:'40px', marginBottom:'12px'}}>🏢</div>
                    <div style={{fontSize:'15px', fontWeight:600, marginBottom:'8px'}}>Hech qanday kompaniya yo'q</div>
                    <div style={{fontSize:'13px'}}>Birinchi mijozni qo'shing</div>
                    <button className="btn-primary" style={{marginTop:'16px', padding:'10px 24px'}} onClick={()=>setView('create')}>+ Kompaniya qo'shish</button>
                  </div>
                )}
                <div style={{display:'flex', flexDirection:'column', gap:'10px'}}>
                  {companies.map(c => (
                    <div key={c.id} style={{background:'var(--bg-surface)', border:'1px solid var(--outline-variant)', borderRadius:'12px', padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'12px', flexWrap:'wrap'}}>
                      <div style={{display:'flex', alignItems:'center', gap:'14px', flex:1}}>
                        <div style={{width:'42px', height:'42px', background:c.is_active?'rgba(1,167,80,0.12)':'var(--surface-variant)', borderRadius:'10px', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                          <span style={{fontSize:'18px', fontWeight:800, color:c.is_active?'#01a750':'var(--text-muted)'}}>{c.name[0]?.toUpperCase()}</span>
                        </div>
                        <div>
                          <div style={{fontWeight:700, fontSize:'15px'}}>{c.name}</div>
                          <div style={{fontSize:'12px', color:'var(--text-muted)', marginTop:'3px', display:'flex', gap:'12px', flexWrap:'wrap'}}>
                            <span style={{display:'inline-flex', alignItems:'center', gap:'5px'}}>
                              🔗 <code style={{background:'var(--surface-variant)', padding:'1px 6px', borderRadius:'4px', fontSize:'11px'}}>{c.slug}.{MAIN_DOMAIN}</code>
                              <button onClick={e=>{e.stopPropagation();copyUrl(c.slug);}} title="Linkni nusxalash" style={{background: copiedSlug===c.slug?'#059669':'var(--surface-variant)', border:'1px solid '+(copiedSlug===c.slug?'#059669':'var(--outline-variant)'), color: copiedSlug===c.slug?'white':'var(--text-muted)', borderRadius:'4px', padding:'1px 7px', fontSize:'10px', cursor:'pointer', fontWeight:700, transition:'all 0.2s', whiteSpace:'nowrap'}}>
                                {copiedSlug===c.slug ? '✓' : '📋'}
                              </button>
                            </span>
                            <span>👥 {c.user_count||0} xodim</span>
                            <span>📋 {c.lead_count||0} lead</span>
                            <span>📞 limit: {c.call_limit}</span>
                            <span style={{padding:'1px 8px', borderRadius:'10px', fontSize:'10px', fontWeight:700, background:`${planBadge(c.plan)}22`, color:planBadge(c.plan)}}>{c.plan?.toUpperCase()}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                        <span style={{padding:'3px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:700, background:c.is_active?'rgba(1,167,80,0.12)':'rgba(239,68,68,0.1)', color:c.is_active?'#01a750':'#ef4444', border:`1px solid ${c.is_active?'rgba(1,167,80,0.3)':'rgba(239,68,68,0.3)'}`}}>
                          {c.is_active?'Faol':'Bloklangan'}
                        </span>
                        <button className="btn-outline" style={{padding:'6px 14px', fontSize:'12px'}} onClick={()=>openDetail(c)}>Boshqarish</button>
                        <button className="btn-outline" style={{padding:'6px 12px', fontSize:'11px'}} onClick={e=>{e.stopPropagation();openEditComp(c);}}>✏️</button>
                        <button className={c.is_active?'btn-outline':'btn-primary'} style={{padding:'6px 12px', fontSize:'11px'}} onClick={()=>toggleActive(c)}>
                          {c.is_active?'Bloklash':'Faollashtirish'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            </>}
          </div>

          {/* ── EDIT COMPANY MODAL (Task 5) ── */}
          {editCompModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}} onClick={e=>{if(e.target===e.currentTarget)setEditCompModal(null);}}>
              <div style={{background:'var(--bg-surface)',borderRadius:'14px',width:'100%',maxWidth:'520px',boxShadow:'0 24px 64px rgba(0,0,0,0.5)'}}>
                <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--outline-variant)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:'15px'}}>Kompaniyani tahrirlash</div>
                    <div style={{fontSize:'11px',color:'var(--text-muted)',marginTop:'2px'}}>{editCompModal.name}</div>
                  </div>
                  <button onClick={()=>setEditCompModal(null)} style={{background:'none',border:'none',fontSize:'18px',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
                </div>
                <form onSubmit={submitEditComp} style={{padding:'18px 22px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                  <div style={{gridColumn:'1/-1'}}>
                    <span className="label-sm">Kompaniya nomi *</span>
                    <input className="input-base" style={{marginBottom:0}} placeholder="Kompaniya nomi" value={editCompForm.name} onChange={e=>setEditCompForm({...editCompForm,name:e.target.value})} required />
                  </div>
                  <div>
                    <span className="label-sm">URL Slug</span>
                    <input className="input-base" style={{marginBottom:0}} placeholder="slug" value={editCompForm.slug} onChange={e=>setEditCompForm({...editCompForm,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'-')})} />
                    {editCompForm.slug && <div style={{fontSize:'10px',color:'var(--text-muted)',marginTop:'3px'}}>{editCompForm.slug}.{MAIN_DOMAIN}</div>}
                  </div>
                  <div>
                    <span className="label-sm">Email</span>
                    <input className="input-base" style={{marginBottom:0}} type="email" placeholder="info@kompaniya.uz" value={editCompForm.email} onChange={e=>setEditCompForm({...editCompForm,email:e.target.value})} />
                  </div>
                  <div>
                    <span className="label-sm">Tarif rejasi</span>
                    <select className="input-base" style={{marginBottom:0}} value={editCompForm.plan} onChange={e=>setEditCompForm({...editCompForm,plan:e.target.value})}>
                      <option value="basic">Basic</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option>
                    </select>
                  </div>
                  <div>
                    <span className="label-sm">Qo'ng'iroq limiti</span>
                    <input className="input-base" style={{marginBottom:0}} type="number" min="1" max="50" value={editCompForm.call_limit} onChange={e=>setEditCompForm({...editCompForm,call_limit:parseInt(e.target.value)||5})} />
                  </div>
                  <div style={{gridColumn:'1/-1',display:'flex',gap:'8px',marginTop:'4px'}}>
                    <button className="btn-primary" type="submit" disabled={editCompSaving} style={{flex:1,padding:'10px'}}>{editCompSaving?'Saqlanmoqda...':'💾 Saqlash'}</button>
                    <button className="btn-outline" type="button" style={{padding:'10px 16px'}} onClick={()=>setEditCompModal(null)}>Bekor</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      );
    };


    // ===== GLOBAL EXPORTS (modules.js → app.js scope sharing) =====
    window._CRM = {
      Ico, calculateSLAHours, determineSLAType,
      initialPipelines, initialColumns, initialLeads,
      getInitials, colColors,
      DashboardOverview, PipelineEditor, UserManagement,
      GlobalLimitsConfig, IntegrationsModule, CallCenterModule,
      HisobotlarModule, AutomationModule, MarketingModule, SuperAdminPanel
    };
