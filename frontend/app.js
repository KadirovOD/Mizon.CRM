const {
  useState,
  useEffect,
  useRef
} = React;
const {
  Ico,
  calculateSLAHours,
  determineSLAType,
  initialPipelines,
  initialColumns,
  initialLeads,
  getInitials,
  colColors,
  DashboardOverview,
  PipelineEditor,
  UserManagement,
  GlobalLimitsConfig,
  IntegrationsModule,
  CallCenterModule,
  HisobotlarModule,
  AutomationModule,
  MarketingModule,
  SuperAdminPanel
} = window._CRM;
// ===== APP =====
const App = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isFormMode = urlParams.get('leadForm') === 'true';
  const formPipeId = urlParams.get('pipe');

  // ── Company slug: subdomen → ?company= → bo'sh ──────────────
  // slug.mizon-crm.uz  →  slug
  // mizon-crm.uz?company=slug  →  slug  (eski havolalar / mahalliy dev)
  const companySlug = (() => {
    const host = window.location.hostname;
    const DOMAIN = 'mizon-crm.uz';
    if (host !== DOMAIN && host !== 'www.' + DOMAIN && host.endsWith('.' + DOMAIN)) {
      const sub = host.slice(0, host.length - DOMAIN.length - 1);
      if (sub && sub !== 'www') return sub;
    }
    return urlParams.get('company') || '';
  })();
  const isSuperAdminMode = urlParams.get('superadmin') === 'true';

  // ── Auth state ───────────────────────────────────────────────
  const [users, setUsers] = useState([]); // API dan yuklanadi (login dan keyin)
  const [authUser, setAuthUser] = useState(() => {
    try {
      const s = localStorage.getItem('mizon_session');
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  });
  const [companyInfo, setCompanyInfo] = useState(null); // { name, slug, logo_url, is_active }
  const [darkMode, setDarkMode] = useState(() => {
    const s = localStorage.getItem('mizon_theme');
    return s ? s === 'dark' : true;
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('mizon_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);
  const [loginForm, setLoginForm] = useState({
    username: '',
    password: ''
  });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLock, setLoginLock] = useState(null); // {secsLeft, until}
  const [showLoginPass, setShowLoginPass] = useState(false);

  // Countdown timer for locked state
  useEffect(() => {
    if (!loginLock) return;
    if (loginLock.secsLeft <= 0) {
      setLoginLock(null);
      return;
    }
    const iv = setInterval(() => {
      const remaining = Math.ceil((loginLock.until - Date.now()) / 1000);
      if (remaining <= 0) {
        setLoginLock(null);
        clearInterval(iv);
      } else setLoginLock(prev => prev ? {
        ...prev,
        secsLeft: remaining
      } : null);
    }, 1000);
    return () => clearInterval(iv);
  }, [loginLock?.until]);
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('mizon_activeTab') || 'dashboard');
  const [settingsActiveTab, setSettingsActiveTab] = useState(() => localStorage.getItem('mizon_settingsTab') || 'users');

  // ── Bildirishnomalar state ────────────────────────────────────────────────
  const [notifications, setNotifications] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  // Kompaniyaga bog'liq kalitdan yuklash
  useEffect(() => {
    if (!authUser) return;
    const key = `mizon_notifs_${authUser.companyId || 'local'}`;
    try {
      setNotifications(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch {
      setNotifications([]);
    }
  }, [authUser?.companyId]);
  // Har o'zgarishda saqlash
  useEffect(() => {
    if (!authUser) return;
    const key = `mizon_notifs_${authUser.companyId || 'local'}`;
    localStorage.setItem(key, JSON.stringify(notifications));
  }, [notifications]);
  // Panelni tashqarida bosganda yopish
  useEffect(() => {
    if (!showNotifPanel) return;
    const close = e => {
      if (!e.target.closest('.notif-panel') && !e.target.closest('.notif-wrap')) setShowNotifPanel(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showNotifPanel]);
  useEffect(() => {
    localStorage.setItem('mizon_activeTab', activeTab);
  }, [activeTab]);
  useEffect(() => {
    localStorage.setItem('mizon_settingsTab', settingsActiveTab);
  }, [settingsActiveTab]);
  const [pipelines, setPipelines] = useState(() => {
    const s = localStorage.getItem('mizon_pipelines');
    return s ? JSON.parse(s) : initialPipelines;
  });
  const [columnsMap, setColumnsMap] = useState(() => {
    const s = localStorage.getItem('mizon_columnsMap');
    return s ? JSON.parse(s) : initialColumns;
  });
  const [leads, setLeads] = useState(() => {
    const s = localStorage.getItem('mizon_leads');
    if (s) {
      try {
        return JSON.parse(s);
      } catch (e) {}
    }
    return [];
  });

  // Stage mapping — API dan dinamik yangilanadi (hardcoded ID'lar yangi kompaniyalarda ishlamaydi)
  const _STAGE_KEYS = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
  const stageMapRef = React.useRef({
    toFrontend: {
      1: 'NEW',
      2: 'CONTACTED',
      3: 'QUALIFIED',
      4: 'PROPOSAL',
      5: 'NEGOTIATION',
      6: 'WON',
      7: 'LOST'
    },
    toDbId: {
      'NEW': 1,
      'CONTACTED': 2,
      'QUALIFIED': 3,
      'PROPOSAL': 4,
      'NEGOTIATION': 5,
      'WON': 6,
      'LOST': 7,
      'MEETING': 2,
      'CONTRACT': 3
    }
  });

  // Fetch company info from slug (for branded login page)
  useEffect(() => {
    if (!companySlug) return;
    fetch(`/api/company/info?slug=${encodeURIComponent(companySlug)}`).then(r => r.json()).then(d => {
      if (d.found) setCompanyInfo(d);
    }).catch(() => {});
  }, [companySlug]);

  // Helper: auth headers for all API calls
  const getAuthHeaders = () => {
    const t = localStorage.getItem('mizon_token');
    return {
      'Content-Type': 'application/json',
      ...(t ? {
        'Authorization': 'Bearer ' + t
      } : {})
    };
  };

  // Kompaniyaga tegishli BARCHA localStorage kalitlarini tozalash
  // (boshqa kompaniyaning ma'lumotlari aralashmasligi uchun)
  const clearCompanyCache = () => {
    const KEEP = new Set(['mizon_session', 'mizon_token', 'mizon_theme', 'mizon_callLimit', 'mizon_activeTab', 'mizon_settingsTab', 'mizon_selectedLeadId']);
    Object.keys(localStorage).filter(k => k.startsWith('mizon_') && !KEEP.has(k)).forEach(k => localStorage.removeItem(k));
  };
  // Markaziy logout helper (token muddati tugaganda ishlatiladi)
  const forceLogout = () => {
    clearCompanyCache();
    setAuthUser(null);
    localStorage.removeItem('mizon_token');
    localStorage.removeItem('mizon_session');
  };

  // Leads + bosqichlarni API dan qayta yuklash (PipelineEditor saqlagandan keyin ham chaqiriladi)
  const reloadLeadsFromApi = React.useCallback(() => {
    const headers = {};
    const t = localStorage.getItem('mizon_token');
    if (t) headers['Authorization'] = 'Bearer ' + t;
    fetch('/api/leads', {
      headers
    }).then(res => {
      if (res.status === 401) {
        forceLogout();
        return null;
      }
      if (!res.ok) throw new Error('API mavjud emas');
      return res.json();
    }).then(data => {
      if (!data) return;
      if (data.success) {
        // Dinamik stage mapping — API bosqichlariga asoslangan (yangi kompaniyalar uchun muhim)
        const apiStages = [...(data.stages || [])].sort((a, b) => a.sequence - b.sequence);
        if (apiStages.length > 0) {
          const toFrontend = {},
            toDbId = {};
          apiStages.forEach((s, i) => {
            const k = _STAGE_KEYS[i] || 'STAGE_' + s.id;
            toFrontend[s.id] = k;
            toDbId[k] = s.id;
          });
          stageMapRef.current = {
            toFrontend,
            toDbId
          };
          // Kanban ustunlarini DB bosqich nomlari bilan yangilash
          setColumnsMap(prev => ({
            ...prev,
            p1: apiStages.map((s, i) => ({
              id: _STAGE_KEYS[i] || 'STAGE_' + s.id,
              title: s.name,
              is_won: s.is_won || false,
              is_lost: s.is_lost || false
            }))
          }));
        }
        // 0 lead bo'lsa ham DOIM yangilash (localStorage'dagi eski ma'lumotni tozalash uchun)
        setLeads((data.leads || []).map(l => ({
          id: l.id,
          pipelineId: l.pipelineid || 'p1',
          name: l.name,
          owner: l.owner || 'ceo',
          phone: l.phone,
          region: l.region || 'Toshkent',
          source: l.mizon_source || 'manual',
          status: stageMapRef.current.toFrontend[l.stage_id] || 'NEW',
          actualCallAttempts: l.actualcallattempts || 0,
          deadline: l.deadline || null,
          taskDescription: l.taskdescription || null,
          customData: (typeof l.custom_data === 'string' ? JSON.parse(l.custom_data) : l.custom_data) || {},
          chatLogs: typeof l.chatlogs === 'string' ? JSON.parse(l.chatlogs) : l.chatlogs || [{
            type: 'sys',
            date: l.created_at,
            text: "Tizimga qo'shildi"
          }],
          taskAssignee: (() => {
            if (l.taskassignee) return l.taskassignee;
            if (!l.deadline) return null;
            const logs = typeof l.chatlogs === 'string' ? JSON.parse(l.chatlogs) : l.chatlogs || [];
            const last = logs.reduce((f, lg) => lg.type === 'sys' && lg.isTask ? lg : f, null);
            return last?.assignee || null;
          })()
        })));
      }
    }).catch(err => console.log('Offline/Demo rejim faol.', err.message));
  }, []);
  useEffect(() => {
    reloadLeadsFromApi();
  }, []);

  // Task 7: globalCallLimit — localStorage dan o'qish (login paytida saqlanadi)
  const [globalCallLimit, setGlobalCallLimit] = useState(() => {
    const saved = localStorage.getItem('mizon_callLimit');
    return saved ? parseInt(saved) || 5 : 5;
  });
  // Startup: API dan call_limit yuklash (localStorage ga sync)
  useEffect(() => {
    const t = localStorage.getItem('mizon_token');
    if (!t) return;
    fetch('/api/company/settings', {
      headers: {
        'Authorization': 'Bearer ' + t
      }
    }).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.call_limit) {
        setGlobalCallLimit(d.call_limit);
        localStorage.setItem('mizon_callLimit', String(d.call_limit));
      }
    }).catch(() => {});
  }, []);
  useEffect(() => {
    localStorage.setItem('mizon_pipelines', JSON.stringify(pipelines));
  }, [pipelines]);
  useEffect(() => {
    localStorage.setItem('mizon_columnsMap', JSON.stringify(columnsMap));
  }, [columnsMap]);
  useEffect(() => {
    localStorage.setItem('mizon_leads', JSON.stringify(leads));
  }, [leads]);
  const [activePipe, setActivePipe] = useState(pipelines[0]?.id || null);
  // selectedLeadId — localStorage ga saqlanadi (refresh'dan keyin karta ochiq qoladi)
  const [selectedLeadId, setSelectedLeadId] = useState(() => {
    const tab = localStorage.getItem('mizon_activeTab');
    const saved = localStorage.getItem('mizon_selectedLeadId');
    if (!saved || tab !== 'leads') return null;
    const n = parseInt(saved);
    return isNaN(n) ? saved : n; // string ID (L_xxx) yoki raqam
  });
  useEffect(() => {
    if (selectedLeadId != null) localStorage.setItem('mizon_selectedLeadId', String(selectedLeadId));else localStorage.removeItem('mizon_selectedLeadId');
  }, [selectedLeadId]);
  const [taskDescInput, setTaskDescInput] = useState('');
  const [taskDateInput, setTaskDateInput] = useState('');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [showTaskInput, setShowTaskInput] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [taskCompleteNote, setTaskCompleteNote] = useState('');
  const [inlineCompleteId, setInlineCompleteId] = useState(null);
  const [inlineCompleteNote, setInlineCompleteNote] = useState('');
  const [chatMessageInput, setChatMessageInput] = useState('');
  const [showAddLead, setShowAddLead] = useState(false);
  const [newLeadForm, setNewLeadForm] = useState({
    name: '',
    phone: '',
    region: ''
  });
  const [formFields, setFormFields] = useState(() => {
    const s = localStorage.getItem('mizon_formFields');
    return s ? JSON.parse(s) : [{
      id: 'f1',
      label: 'Ism va Familiya',
      key: 'name',
      type: 'text',
      required: true,
      placeholder: 'Abdulla Qodiriy...'
    }, {
      id: 'f2',
      label: 'Telefon raqam',
      key: 'phone',
      type: 'tel',
      required: true,
      placeholder: '+998 90 123 45 67'
    }, {
      id: 'f3',
      label: 'Manzil',
      key: 'region',
      type: 'text',
      required: false,
      placeholder: 'Toshkent shahri...'
    }];
  });
  useEffect(() => {
    localStorage.setItem('mizon_formFields', JSON.stringify(formFields));
  }, [formFields]);

  // Mijoz kartasidagi qo'shimcha (custom) maydonlar
  const [cardFields, setCardFields] = useState(() => {
    const s = localStorage.getItem('mizon_cardFields');
    return s ? JSON.parse(s) : [];
  });
  useEffect(() => {
    localStorage.setItem('mizon_cardFields', JSON.stringify(cardFields));
  }, [cardFields]);

  // Forma sarlavhasi va qo'shimcha matn (Veb Shakl sozlamalari)
  const [formSettings, setFormSettings] = useState({
    form_title: '',
    form_subtitle: ''
  });
  const [formSettingsSaving, setFormSettingsSaving] = useState(false);
  useEffect(() => {
    const t = localStorage.getItem('mizon_token');
    if (!t) return;
    fetch('/api/company/settings', {
      headers: {
        'Authorization': 'Bearer ' + t
      }
    }).then(r => r.ok ? r.json() : null).then(d => {
      if (d) setFormSettings({
        form_title: d.form_title || '',
        form_subtitle: d.form_subtitle || ''
      });
    }).catch(() => {});
  }, []);
  const saveFormSettings = async () => {
    setFormSettingsSaving(true);
    const t = localStorage.getItem('mizon_token');
    try {
      const r = await fetch('/api/company/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + t
        },
        body: JSON.stringify(formSettings)
      });
      const d = await r.json();
      alert(d.success ? '✅ Saqlandi!' : '❌ ' + (d.error || 'Xato'));
    } catch (e) {
      alert('❌ Server xatosi');
    }
    setFormSettingsSaving(false);
  };

  // VoIP holat — Integratsiyalar bo'limidan sozlanganmi?
  const [voipConfigured, setVoipConfigured] = useState(false);
  useEffect(() => {
    const t = localStorage.getItem('mizon_token');
    if (!t || !authUser) return;
    fetch('/api/voip/config', {
      headers: {
        'Authorization': 'Bearer ' + t
      }
    }).then(r => r.ok ? r.json() : null).then(d => {
      if (d) setVoipConfigured(d.configured === true);
    }).catch(() => {});
  }, [authUser?.companyId]);

  // Xodimlar ro'yxatini API dan yuklash (lead karta "Mas'ul xodim" dropdown + loglar)
  useEffect(() => {
    const t = localStorage.getItem('mizon_token');
    if (!t || !authUser) return;
    fetch('/api/company/users', {
      headers: {
        'Authorization': 'Bearer ' + t
      }
    }).then(r => r.ok ? r.json() : null).then(d => {
      if (Array.isArray(d) && d.length > 0) setUsers(d);
    }).catch(() => {});
  }, [authUser?.companyId]);
  const [editingLead, setEditingLead] = useState(false);
  // Tahrirlashga kirishda lead'ning asl nusxasini saqlaymiz (audit trail uchun)
  const [editLeadSnapshot, setEditLeadSnapshot] = useState(null);

  // syncLeadToAPI holati: null | 'saving' | 'saved' | 'error'
  const [syncStatus, setSyncStatus] = useState(null);
  useEffect(() => {
    if (!syncStatus || syncStatus === 'saving') return;
    const delay = syncStatus === 'error' ? 4000 : 2500;
    const t = setTimeout(() => setSyncStatus(null), delay);
    return () => clearTimeout(t);
  }, [syncStatus]);

  // O'zgargan maydonlarni aniqlash va audit matni yaratish
  const buildAuditChanges = (oldLead, newLead) => {
    if (!oldLead || !newLead) return [];
    const FIELDS = {
      name: 'Ism',
      phone: 'Telefon',
      region: 'Manzil',
      source: 'Manba',
      owner: "Mas'ul xodim"
    };
    return Object.entries(FIELDS).filter(([k]) => (oldLead[k] || '') !== (newLead[k] || '')).map(([k, label]) => `${label}: "${oldLead[k] || '—'}" → "${newLead[k] || '—'}"`);
  };

  // Saqlash paytida audit log yarataib chatLogs ga qo'shish
  const applyAuditAndSave = (lead, snapshot) => {
    const changes = buildAuditChanges(snapshot, lead);
    let finalLead = lead;
    if (changes.length > 0) {
      const auditEntry = {
        type: 'audit',
        date: new Date().toISOString(),
        by: authUser?.username || '?',
        text: `✏️ ${authUser?.username || 'Noma\'lum'} o\'zgartirdi: ${changes.join(' | ')}`
      };
      finalLead = {
        ...lead,
        chatLogs: [...(lead.chatLogs || []), auditEntry]
      };
      setLeads(prev => prev.map(l => String(l.id) === String(lead.id) ? finalLead : l));
    }
    syncLeadToAPI(finalLead);
    setHasUnsavedChanges(false);
    setEditLeadSnapshot(null);
    return finalLead;
  };

  // ── Lidni o'chirish (faqat CEO/SUPERADMIN) ──
  const handleDeleteLead = id => {
    if (!window.confirm("Bu lidni butunlay o'chirmoqchimisiz? Bu amalni ortga qaytarib bo'lmaydi!")) return;
    const closeAndRemove = () => {
      setLeads(prev => prev.filter(l => String(l.id) !== String(id)));
      setSelectedLeadId(null);
      setHasUnsavedChanges(false);
      setEditLeadSnapshot(null);
    };
    // Hali API ga saqlanmagan lokal lid — to'g'ridan-to'g'ri olib tashlaymiz
    if (String(id).startsWith('L_') || String(id).startsWith('EXT_')) {
      closeAndRemove();
      return;
    }
    fetch('/api/leads/' + id, {
      method: 'DELETE',
      headers: getAuthHeaders()
    }).then(async res => {
      if (res.status === 401) {
        forceLogout();
        return;
      }
      if (res.status === 403) {
        alert("Faqat CEO lidlarni o'chira oladi");
        return;
      }
      if (!res.ok) {
        const b = await res.text().catch(() => '');
        alert("O'chirishda xato: " + res.status + ' ' + b);
        return;
      }
      closeAndRemove();
    }).catch(err => alert("Tarmoq xatosi — o'chirib bo'lmadi: " + err.message));
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [callingLeadId, setCallingLeadId] = useState(null); // VoIP: active call lead ID

  // isFormMode — tashqi forma
  if (isFormMode) {
    const [extFormData, setExtFormData] = useState({});
    const [extSubmitted, setExtSubmitted] = useState(false);
    // Kompaniya ma'lumotlarini URL dagi slug yoki subdomain orqali yuklash
    const [extCompanyInfo, setExtCompanyInfo] = useState(null);
    useEffect(() => {
      const slug = companySlug || new URLSearchParams(window.location.search).get('company') || '';
      if (!slug) return;
      fetch(`/api/company/info?slug=${encodeURIComponent(slug)}`).then(r => r.json()).then(d => {
        if (d.found) setExtCompanyInfo(d);
      }).catch(() => {});
    }, []);
    const extTitle = extCompanyInfo?.form_title || extCompanyInfo?.name || "Ro'yxatdan o'tish";
    const extSubtitle = extCompanyInfo?.form_subtitle || "Ma'lumotlaringizni qoldiring, tez orada aloqaga chiqamiz.";
    const companyName = extCompanyInfo?.name || '';
    const handleExtSubmit = async e => {
      e.preventDefault();
      const nameField = formFields.find(f => f.key === 'name');
      const phoneField = formFields.find(f => f.key === 'phone');
      if (nameField && nameField.required && !extFormData.name) return alert("Ismingizni kiriting!");
      if (phoneField && phoneField.required && !extFormData.phone) return alert("Telefon raqamni kiriting!");
      const cols = columnsMap[formPipeId] || [];
      const initialStage = cols[0] ? cols[0].id : 'NEW';
      const extraInfo = formFields.filter(f => !['name', 'phone', 'region'].includes(f.key)).map(f => `${f.label}: ${extFormData[f.key] || '-'}`).join(' | ');
      // API ga yuborish
      try {
        await fetch('/api/leads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: extFormData.name || "Noma'lum",
            phone: extFormData.phone || '',
            region: extFormData.region || 'Veb-Sayt',
            source: 'website',
            owner: 'Navbatda',
            pipelineId: formPipeId || 'p1',
            status: stageMapRef.current.toDbId[initialStage] || null
          })
        });
      } catch (err) {
        console.log('Forma yuborishda xato:', err.message);
      }
      setExtSubmitted(true);
    };
    if (extSubmitted) return /*#__PURE__*/React.createElement("div", {
      className: "login-overlay"
    }, /*#__PURE__*/React.createElement("div", {
      className: "login-box",
      style: {
        maxWidth: '440px',
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '48px',
        marginBottom: '16px'
      }
    }, "\u2705"), /*#__PURE__*/React.createElement("h2", {
      style: {
        fontSize: '22px',
        marginBottom: '8px',
        fontWeight: 800
      }
    }, "Rahmat!"), /*#__PURE__*/React.createElement("p", {
      style: {
        color: 'var(--text-muted)',
        fontSize: '14px',
        lineHeight: '1.6'
      }
    }, "Arizangiz qabul qilindi. ", companyName ? `${companyName} jamoasi ` : '', " tez orada siz bilan bog'lanadi.")));
    return /*#__PURE__*/React.createElement("div", {
      className: "login-overlay",
      style: {
        alignItems: 'flex-start',
        paddingTop: '60px'
      }
    }, /*#__PURE__*/React.createElement("form", {
      className: "login-box",
      style: {
        maxWidth: '480px',
        width: '100%'
      },
      onSubmit: handleExtSubmit
    }, companyName && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '11px',
        color: 'var(--text-muted)',
        marginBottom: '8px',
        textAlign: 'center',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        fontWeight: 600
      }
    }, companyName), /*#__PURE__*/React.createElement("h2", {
      style: {
        fontSize: '24px',
        marginBottom: '8px',
        fontWeight: 800,
        textAlign: 'center'
      }
    }, extTitle), /*#__PURE__*/React.createElement("p", {
      style: {
        color: 'var(--text-muted)',
        marginBottom: '24px',
        fontSize: '13px',
        textAlign: 'center',
        lineHeight: '1.6'
      }
    }, extSubtitle), formFields.map(f => /*#__PURE__*/React.createElement("div", {
      key: f.id
    }, /*#__PURE__*/React.createElement("span", {
      className: "label-sm"
    }, f.label, f.required ? ' *' : ''), /*#__PURE__*/React.createElement("input", {
      className: "input-base",
      type: f.type || 'text',
      placeholder: f.placeholder || '',
      value: extFormData[f.key] || '',
      onChange: e => setExtFormData({
        ...extFormData,
        [f.key]: e.target.value
      })
    }))), /*#__PURE__*/React.createElement("button", {
      className: "btn-primary",
      style: {
        width: '100%',
        marginTop: '16px',
        padding: '14px',
        fontSize: '15px'
      },
      type: "submit"
    }, "Arizani Jo'natish \u2192")));
  }
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(iv);
  }, []);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // ── Refs: event handler'lar uchun joriy state ni saqlash (stale closure oldini olish) ──
  const stateRefs = useRef({
    selectedLeadId: null,
    showAddLead: false,
    showCompleteModal: false,
    activeTab: 'dashboard',
    editLeadSnapshot: null,
    editingLead: false,
    leads: [],
    authUser: null
  });
  useEffect(() => {
    stateRefs.current = {
      selectedLeadId,
      showAddLead,
      showCompleteModal,
      activeTab,
      editLeadSnapshot,
      editingLead,
      leads,
      authUser
    };
  }, [selectedLeadId, showAddLead, showCompleteModal, activeTab, editLeadSnapshot, editingLead, leads, authUser]);

  // ── Orqaga tugmasi (touchpad swipe / browser back) ──────────
  useEffect(() => {
    if (!authUser) return;
    // Ilovadan chiqib ketmaslik uchun history ga bir qadam qo'shamiz
    history.pushState({
      mizonCRM: true
    }, '', window.location.href);
    const handlePopState = () => {
      // Darhol yangi state push qilib, brauzer orqaga ketishini to'xamiz
      history.pushState({
        mizonCRM: true
      }, '', window.location.href);
      const s = stateRefs.current;
      if (s.selectedLeadId) {
        setSelectedLeadId(null);
        setShowCompleteModal(false);
        setHasUnsavedChanges(false);
      } else if (s.showCompleteModal) {
        setShowCompleteModal(false);
      } else if (s.showAddLead) {
        setShowAddLead(false);
      } else if (s.activeTab !== 'dashboard') {
        setActiveTab('dashboard');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [authUser]);

  // ── Klaviatura: ESC va Enter ─────────────────────────────────
  // [] — bir marta ro'yxatdan o'tadi, stateRefs orqali har doim yangi qiymatlar o'qiladi
  useEffect(() => {
    const handleKeyDown = e => {
      const s = stateRefs.current;

      // ── ESC: bekor qilish va yopish ──────────────────────────
      if (e.key === 'Escape') {
        if (s.selectedLeadId) {
          // Tahrirlash rejimida bo'lsa — snapshot ga qaytarish (o'zgarishlar saqlanmaydi)
          if (s.editLeadSnapshot) {
            setLeads(prev => prev.map(l => String(l.id) === String(s.selectedLeadId) ? s.editLeadSnapshot : l));
            setEditLeadSnapshot(null);
            setEditingLead(false);
          }
          setSelectedLeadId(null);
          setShowCompleteModal(false);
          setHasUnsavedChanges(false);
        } else if (s.showCompleteModal) {
          setShowCompleteModal(false);
        } else if (s.showAddLead) {
          setShowAddLead(false);
        }
        return;
      }

      // ── Enter: saqlash va yopish ──────────────────────────────
      if (e.key === 'Enter' && s.selectedLeadId) {
        // Matn kiritish maydonlarida Enter ni ushlamaymiz
        if (e.target.id === 'chatMessageInputBox') return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

        // Joriy leadni leads massividan topamiz
        const currentLead = (s.leads || []).find(l => String(l.id) === String(s.selectedLeadId));
        if (currentLead) {
          // applyAuditAndSave mantiqini inline bajarish (stale closure yo'q)
          const snapshot = s.editLeadSnapshot;
          const FIELDS = {
            name: 'Ism',
            phone: 'Telefon',
            region: 'Manzil',
            source: 'Manba',
            owner: "Mas'ul xodim"
          };
          const changes = snapshot ? Object.entries(FIELDS).filter(([k]) => (snapshot[k] || '') !== (currentLead[k] || '')).map(([k, label]) => `${label}: "${snapshot[k] || '—'}" → "${currentLead[k] || '—'}"`) : [];
          let finalLead = currentLead;
          if (changes.length > 0) {
            const by = s.authUser?.username || "Noma'lum";
            finalLead = {
              ...currentLead,
              chatLogs: [...(currentLead.chatLogs || []), {
                type: 'audit',
                date: new Date().toISOString(),
                by,
                text: `✏️ ${by} o'zgartirdi: ${changes.join(' | ')}`
              }]
            };
            setLeads(prev => prev.map(l => String(l.id) === String(currentLead.id) ? finalLead : l));
            // Faqat haqiqiy o'zgarishlar bo'lganda API ga saqlash
            if (!String(finalLead.id).startsWith('L_') && !String(finalLead.id).startsWith('EXT_')) {
              setSyncStatus('saving');
              const token = localStorage.getItem('mizon_token');
              fetch('/api/leads/' + finalLead.id, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? {
                    Authorization: 'Bearer ' + token
                  } : {})
                },
                body: JSON.stringify({
                  status: stageMapRef.current.toDbId[finalLead.status] || finalLead.status,
                  name: finalLead.name,
                  phone: finalLead.phone,
                  region: finalLead.region,
                  source: finalLead.source,
                  actualCallAttempts: finalLead.actualCallAttempts,
                  deadline: finalLead.deadline,
                  taskDescription: finalLead.taskDescription,
                  chatLogs: finalLead.chatLogs,
                  owner: finalLead.owner,
                  customData: finalLead.customData || {}
                })
              }).then(res => {
                if (!res.ok) setSyncStatus('error');else setSyncStatus('saved');
              }).catch(() => setSyncStatus('error'));
            }
          }
        }
        setEditingLead(false);
        setEditLeadSnapshot(null);
        setSelectedLeadId(null);
        setShowCompleteModal(false);
        setHasUnsavedChanges(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  const handleLogin = async e => {
    e.preventDefault();
    if (loginLock && loginLock.secsLeft > 0) return; // bloklangan
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password,
          company_slug: companySlug
        })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.locked && data.secsLeft) {
          setLoginLock({
            secsLeft: data.secsLeft,
            until: Date.now() + data.secsLeft * 1000
          });
          setLoginError('');
        } else {
          setLoginError(data.error || "Login yoki parol noto'g'ri");
          if (data.attemptsLeft !== undefined) {
            setLoginError(data.error || `Login yoki parol noto'g'ri. ${data.attemptsLeft} ta urinish qoldi.`);
          }
        }
        setLoginLoading(false);
        return;
      }
      setLoginLock(null);
      // Yangi login — eski kompaniya ma'lumotlarini tozalash
      clearCompanyCache();
      localStorage.setItem('mizon_token', data.token);
      localStorage.setItem('mizon_session', JSON.stringify(data.user));
      if (data.user.callLimit) localStorage.setItem('mizon_callLimit', String(data.user.callLimit));
      setAuthUser(data.user);
      setActiveTab('dashboard');
    } catch {
      // Fallback: local demo auth
      const match = users.find(u => u.username === loginForm.username && u.password === loginForm.password);
      if (match) {
        setAuthUser(match);
        localStorage.setItem('mizon_session', JSON.stringify(match));
        setActiveTab('dashboard');
      } else setLoginError("Server bilan ulanishda xato. Login yoki parol noto'g'ri.");
    } finally {
      setLoginLoading(false);
    }
  };
  if (!authUser) {
    const loginTitle = isSuperAdminMode ? 'MIZON SUPER ADMIN' : companyInfo?.name || 'MIZON CRM';
    const loginSubtitle = isSuperAdminMode ? 'Platforma boshqaruvi. Faqat vakolatli foydalanuvchilar.' : companyInfo?.name ? `${companyInfo.name} — CRM tizimiga xush kelibsiz` : 'Tizimga kirish uchun xodim ruxsatnomasini kiriting.';
    const logoLetter = isSuperAdminMode ? 'S' : companyInfo?.name?.[0]?.toUpperCase() || 'M';
    const logoBg = isSuperAdminMode ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : 'var(--primary-container)';
    return /*#__PURE__*/React.createElement("div", {
      className: "login-overlay"
    }, /*#__PURE__*/React.createElement("form", {
      onSubmit: handleLogin,
      className: "login-box"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: '52px',
        height: '52px',
        background: logoBg,
        borderRadius: '14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 18px',
        boxShadow: '0 0 28px rgba(1,167,80,0.25)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '22px',
        fontWeight: 800,
        color: '#fff',
        fontFamily: 'var(--font-label)'
      }
    }, logoLetter)), /*#__PURE__*/React.createElement("h1", {
      style: {
        fontSize: '24px',
        marginBottom: '5px',
        fontWeight: 800,
        letterSpacing: '-0.6px'
      }
    }, loginTitle), /*#__PURE__*/React.createElement("p", {
      style: {
        color: 'var(--text-muted)',
        marginBottom: '24px',
        fontSize: '12px',
        lineHeight: 1.5
      }
    }, loginSubtitle), loginLock && loginLock.secsLeft > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'rgba(239,68,68,0.08)',
        border: '2px solid rgba(239,68,68,0.4)',
        color: '#ef4444',
        borderRadius: '10px',
        padding: '14px 16px',
        fontSize: '13px',
        marginBottom: '14px',
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '26px',
        marginBottom: '6px'
      }
    }, "\uD83D\uDD12"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        marginBottom: '4px'
      }
    }, "Kirish vaqtincha bloklandi"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '20px',
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.04em',
        margin: '6px 0'
      }
    }, String(Math.floor(loginLock.secsLeft / 60)).padStart(2, '0'), ":", String(loginLock.secsLeft % 60).padStart(2, '0')), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '11px',
        opacity: 0.8
      }
    }, "Blok tugagach qayta urinib ko'ring")), loginError && !loginLock && /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.3)',
        color: '#ef4444',
        borderRadius: '8px',
        padding: '10px 14px',
        fontSize: '12px',
        marginBottom: '14px'
      }
    }, loginError), /*#__PURE__*/React.createElement("input", {
      className: "input-base",
      placeholder: isSuperAdminMode ? "Super admin login" : "Email yoki login",
      value: loginForm.username,
      onChange: e => setLoginForm({
        ...loginForm,
        username: e.target.value
      }),
      autoFocus: true,
      disabled: !!(loginLock && loginLock.secsLeft > 0)
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'relative',
        marginBottom: '0'
      }
    }, /*#__PURE__*/React.createElement("input", {
      className: "input-base",
      type: showLoginPass ? 'text' : 'password',
      placeholder: "Parol",
      value: loginForm.password,
      onChange: e => setLoginForm({
        ...loginForm,
        password: e.target.value
      }),
      disabled: !!(loginLock && loginLock.secsLeft > 0),
      style: {
        marginBottom: 0,
        paddingRight: '40px'
      }
    }), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setShowLoginPass(p => !p),
      tabIndex: -1,
      style: {
        position: 'absolute',
        right: '10px',
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        color: 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        lineHeight: 1
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "material-symbols-outlined",
      style: {
        fontSize: '18px',
        userSelect: 'none'
      }
    }, showLoginPass ? 'visibility_off' : 'visibility'))), /*#__PURE__*/React.createElement("button", {
      className: "btn-primary",
      style: {
        width: '100%',
        marginTop: '8px',
        padding: '12px',
        fontSize: '14px',
        opacity: loginLoading || loginLock && loginLock.secsLeft > 0 ? 0.5 : 1
      },
      type: "submit",
      disabled: loginLoading || loginLock && loginLock.secsLeft > 0
    }, loginLoading ? 'Tekshirilmoqda...' : loginLock && loginLock.secsLeft > 0 ? `🔒 Bloklangan (${Math.ceil(loginLock.secsLeft / 60)} daq)` : 'Tizimga Kirish'), !isSuperAdminMode && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: '16px',
        fontSize: '11px',
        color: 'var(--text-muted)',
        textAlign: 'center'
      }
    }, companySlug ? /*#__PURE__*/React.createElement("span", null, "\uD83C\uDF10 ", /*#__PURE__*/React.createElement("b", {
      style: {
        color: 'var(--primary)'
      }
    }, companySlug, ".mizon-crm.uz")) : /*#__PURE__*/React.createElement("span", null, "\uD83D\uDCA1 Email yoki login va parolni kiriting"))));
  }
  const role = authUser.role;

  // ── Super Admin — full-screen panel ──────────────────────────
  if (role === 'SUPERADMIN') return /*#__PURE__*/React.createElement(SuperAdminPanel, {
    authUser: authUser,
    onLogout: () => {
      clearCompanyCache();
      setAuthUser(null);
      localStorage.removeItem('mizon_session');
      localStorage.removeItem('mizon_token');
    }
  });
  const activeColumns = columnsMap[activePipe] || [];
  const activeLeads = leads.filter(l => l.pipelineId === activePipe);
  const selectedLeadData = leads.find(l => l.id == selectedLeadId);

  // ── Bildirishnoma yordamchi funksiyalari ─────────────────────────────────
  const _notifTypes = {
    sla_danger: '🔴',
    sla_warning: '🟡',
    new_lead: '🆕',
    stage_changed: '🔄',
    call_limit: '📵',
    call_logged: '📞',
    voip_incoming: '📲',
    ext_lead: '🌐',
    task_assigned: '📌'
  };
  const notifIcon = type => _notifTypes[type] || '🔔';
  const timeAgo = iso => {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 60000) return 'Az oldin';
    if (d < 3600000) return Math.round(d / 60000) + ' daq. oldin';
    if (d < 86400000) return Math.round(d / 3600000) + ' soat oldin';
    return Math.round(d / 86400000) + ' kun oldin';
  };
  const unreadCount = notifications.filter(n => !n.read).length;
  const markRead = id => setNotifications(prev => prev.map(n => n.id === id ? {
    ...n,
    read: true
  } : n));
  const markAllRead = () => setNotifications(prev => prev.map(n => ({
    ...n,
    read: true
  })));
  const deleteNotif = id => setNotifications(prev => prev.filter(n => n.id !== id));
  const addNotif = React.useCallback((type, title, body, leadId = null) => {
    setNotifications(prev => {
      // SLA bildirishnomalar: bir xil leadId + type uchun 1 soat ichida qayta yaratmaslik
      if (type.startsWith('sla_') && leadId != null) {
        const dup = prev.some(n => n.type === type && String(n.leadId) === String(leadId) && !n.read && Date.now() - new Date(n.createdAt).getTime() < 3600000);
        if (dup) return prev;
      }
      const newN = {
        id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type,
        title,
        body,
        leadId,
        createdAt: new Date().toISOString(),
        read: false
      };
      return [newN, ...prev].slice(0, 60);
    });
  }, []);

  // Bildirishnoma ovozi (qisqa "ding")
  const playNotifSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {}
  };

  // Menga tayinlangan vazifalarni tekshirish
  useEffect(() => {
    if (!authUser) return;
    const notifiedKey = `mizon_task_ntf_${authUser.companyId || 'local'}_${authUser.username}`;
    const notified = new Set(JSON.parse(localStorage.getItem(notifiedKey) || '[]'));
    let changed = false;
    leads.forEach(l => {
      if (!l.deadline || !l.taskAssignee) return;
      if (l.taskAssignee !== authUser.username) return;
      const taskKey = `${l.id}_${l.deadline}`;
      if (!notified.has(taskKey)) {
        notified.add(taskKey);
        changed = true;
        addNotif('task_assigned', '📌 Sizga vazifa belgilandi', `${l.name} — "${l.taskDescription || 'Vazifa'}" → ${new Date(l.deadline).toLocaleString()}`, l.id);
        playNotifSound();
      }
    });
    if (changed) localStorage.setItem(notifiedKey, JSON.stringify([...notified].slice(-200)));
  }, [leads, authUser]);

  // SLA tekshiruvi — har 5 daqiqada + leads o'zgarganda
  useEffect(() => {
    if (!authUser) return;
    const check = () => {
      const now = Date.now();
      leads.forEach(l => {
        if (!l.deadline || ['WON', 'LOST'].includes(l.status)) return;
        const dl = new Date(l.deadline).getTime();
        const dif = dl - now;
        const nm = l.name || 'Lead #' + l.id;
        if (dif < 0) {
          const h = Math.abs(Math.round(dif / 3600000));
          addNotif('sla_danger', '⏰ Kechikkan vazifa', `${nm} — ${h > 0 ? h + ' soat' : 'bir necha daqiqa'} kechikdi`, l.id);
        } else if (dif < 3600000) {
          addNotif('sla_warning', '⚡ Muddat yaqinlashmoqda', `${nm} — ${Math.round(dif / 60000)} daqiqada muddat tugaydi`, l.id);
        }
      });
    };
    check();
    const iv = setInterval(check, 300000); // har 5 daqiqa
    return () => clearInterval(iv);
  }, [leads, authUser]);

  // Kiruvchi qo'ng'iroqlar — har 30 sek polling (Moizvonki webhook orqali keladiganlar)
  useEffect(() => {
    if (!authUser) return;
    const poll = async () => {
      try {
        const r = await fetch('/api/calls/recent', {
          headers: getAuthHeaders()
        });
        if (!r.ok) return;
        const {
          events
        } = await r.json();
        if (!events?.length) return;
        events.forEach(ev => {
          const isNew = ev.is_new_lead;
          const title = ev.type === 'incoming' ? '📲 Kiruvchi qo\'ng\'iroq' : '📞 VoIP qo\'ng\'iroq';
          const body = isNew ? `${ev.phone} — yangi mijoz avtomatik qo'shildi` : `${ev.phone}${ev.lead_name ? ' — ' + ev.lead_name : ''}`;
          addNotif('voip_incoming', title, body, ev.lead_id || null);
        });
        reloadLeadsFromApi(); // yangi/yangilangan leadlarni ko'rsatish
      } catch {/* server yo'q — skip */}
    };
    const iv = setInterval(poll, 30000);
    return () => clearInterval(iv);
  }, [authUser, addNotif]);
  const syncLeadToAPI = lead => {
    if (String(lead.id).startsWith('L_') || String(lead.id).startsWith('EXT_')) return;
    setSyncStatus('saving');
    fetch('/api/leads/' + lead.id, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        status: stageMapRef.current.toDbId[lead.status] || lead.status,
        name: lead.name,
        phone: lead.phone,
        region: lead.region,
        source: lead.source,
        actualCallAttempts: lead.actualCallAttempts,
        deadline: lead.deadline,
        taskDescription: lead.taskDescription,
        taskAssignee: lead.taskAssignee || null,
        chatLogs: lead.chatLogs,
        owner: lead.owner,
        customData: lead.customData || {}
      })
    }).then(async res => {
      if (res.status === 401) {
        forceLogout();
        return;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('SAQLASH XATOSI:', res.status, body);
        setSyncStatus('error');
        alert("Saqlashda xato (" + res.status + "):\n" + body + "\n\nO'zgarishlar serverga yozilmadi!");
        return;
      }
      setSyncStatus('saved');
    }).catch(err => {
      console.error('Sinxronlashda tarmoq xatosi:', err.message);
      setSyncStatus('error');
      alert("Tarmoq xatosi — o'zgarishlar saqlanmadi: " + err.message);
    });
  };
  const handleAddManualLead = () => {
    if (!newLeadForm.name || !newLeadForm.phone) return alert("Ism va Raqamni kiriting");
    const cols = columnsMap[activePipe];
    if (!cols || cols.length === 0) return alert("Avval quvurga bosqich qo'shing");
    const initialStage = cols[0].id;
    const localLead = {
      id: 'L_' + Date.now(),
      pipelineId: activePipe,
      name: newLeadForm.name,
      phone: newLeadForm.phone,
      region: newLeadForm.region || "Shahar noma'lum",
      source: 'manual',
      owner: authUser.username,
      status: initialStage,
      actualCallAttempts: 0,
      deadline: null,
      taskDescription: null,
      chatLogs: [{
        type: 'sys',
        date: new Date().toISOString(),
        text: `Menejer (${authUser.username}) qo'lda kiritdi.`
      }]
    };
    fetch('/api/leads', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: newLeadForm.name,
        phone: newLeadForm.phone,
        region: newLeadForm.region,
        owner: authUser.username,
        pipelineId: activePipe,
        status: stageMapRef.current.toDbId[initialStage] || 1
      })
    }).then(res => res.json()).then(data => {
      if (data.success) localLead.id = data.lead.id;
      setLeads(prev => [...prev, localLead]);
      setShowAddLead(false);
      setNewLeadForm({
        name: '',
        phone: '',
        region: ''
      });
      addNotif('new_lead', '🆕 Yangi lead qo\'shildi', `${localLead.name} — qo'lda kiritildi (${authUser.username})`, localLead.id);
    }).catch(() => {
      setLeads(prev => [...prev, localLead]);
      setShowAddLead(false);
      setNewLeadForm({
        name: '',
        phone: '',
        region: ''
      });
      addNotif('new_lead', '🆕 Yangi lead qo\'shildi', `${localLead.name} — qo'lda kiritildi`, localLead.id);
    });
  };
  const handleTaskCreate = id => {
    if (!taskDateInput) return alert("Sana va vaqt kiritilishi shart!");
    if (new Date(taskDateInput) <= new Date()) return alert("O'tib ketgan vaqt uchun vazifa belgilab bo'lmaydi!");
    const assignee = taskAssignee || authUser.username;
    let targetLead = null;
    setLeads(prev => prev.map(l => {
      if (l.id == id) {
        targetLead = {
          ...l,
          deadline: taskDateInput,
          taskDescription: taskDescInput || 'Izohsiz vazifa',
          taskAssignee: assignee,
          chatLogs: [...l.chatLogs, {
            type: 'sys',
            isTask: true,
            date: new Date().toISOString(),
            by: authUser.username,
            assignee,
            text: `📌 Vazifa: "${taskDescInput || 'Izohsiz vazifa'}" → ${new Date(taskDateInput).toLocaleString()}`
          }]
        };
        return targetLead;
      }
      return l;
    }));
    setTaskDateInput('');
    setTaskDescInput('');
    setTaskAssignee('');
    setShowTaskInput(false);
    setHasUnsavedChanges(true);
    addNotif('task_assigned', '📌 Vazifa belgilandi', `${assignee} uchun: "${taskDescInput || 'Izohsiz'}"`, id);
    playNotifSound();
    if (targetLead) setTimeout(() => syncLeadToAPI(targetLead), 100);
  };
  const handleTaskComplete = (id, noteOverride) => {
    const note = noteOverride !== undefined ? noteOverride : taskCompleteNote;
    let targetLead = null;
    setLeads(prev => prev.map(l => {
      if (l.id == id) {
        targetLead = {
          ...l,
          deadline: null,
          taskDescription: null,
          taskAssignee: null,
          chatLogs: [...l.chatLogs, {
            type: 'sys',
            date: new Date().toISOString(),
            by: authUser.username,
            text: `✅ Vazifa yakunlandi! Natija: "${note || 'Izohsiz bajardi'}"`
          }]
        };
        return targetLead;
      }
      return l;
    }));
    setShowCompleteModal(false);
    setTaskCompleteNote('');
    setInlineCompleteId(null);
    setInlineCompleteNote('');
    setHasUnsavedChanges(true);
    if (targetLead) setTimeout(() => syncLeadToAPI(targetLead), 100);
  };

  // ---- VoIP: poll chatlogs until recording arrives (max ~2 min) ----
  const startCallPolling = leadId => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts >= 20) {
        clearInterval(interval);
        setCallingLeadId(null);
        return;
      }
      try {
        const r = await fetch(`/api/leads/${leadId}/chatlogs`, {
          headers: getAuthHeaders()
        });
        if (!r.ok) return;
        const data = await r.json();
        setLeads(prev => prev.map(l => {
          if (String(l.id) === String(leadId)) {
            const newLogs = Array.isArray(data.chatlogs) ? data.chatlogs : l.chatLogs;
            // Stop polling when a recording arrives
            if (newLogs.some(lg => lg.record_url)) {
              clearInterval(interval);
              setCallingLeadId(null);
            }
            return {
              ...l,
              chatLogs: newLogs,
              actualCallAttempts: data.actualCallAttempts ?? l.actualCallAttempts
            };
          }
          return l;
        }));
      } catch (e) {/* ignore */}
    }, 6000); // every 6 s
  };
  const handleLogCall = async id => {
    const lead = leads.find(l => l.id == id);
    if (!lead) return;
    setHasUnsavedChanges(true);
    const a = (lead.actualCallAttempts || 0) + 1;

    // Hard limit: mark as LOST
    if (a > globalCallLimit) {
      const limitLead = {
        ...lead,
        actualCallAttempts: a,
        status: 'LOST',
        chatLogs: [...lead.chatLogs, {
          type: 'sys',
          date: new Date().toISOString(),
          by: authUser.username,
          text: `⛔ Limit tugadi (${globalCallLimit} urinish). LOST.`
        }]
      };
      setLeads(prev => prev.map(l => l.id == id ? limitLead : l));
      setTimeout(() => syncLeadToAPI(limitLead), 100);
      addNotif('call_limit', '📵 Qo\'ng\'iroq limiti tugadi', `${lead.name} — ${globalCallLimit} ta urinishdan keyin LOST ga o'tdi`, id);
      return;
    }

    // Immediately show "calling" entry in chat
    setCallingLeadId(String(id));
    const callingLog = {
      type: 'call',
      date: new Date().toISOString(),
      text: `📞 Chiquvchi qo'ng'iroq: ${lead.phone}`,
      direction: 'out',
      status: 'calling'
    };
    const updatedLead = {
      ...lead,
      actualCallAttempts: a,
      chatLogs: [...lead.chatLogs, callingLog]
    };
    setLeads(prev => prev.map(l => l.id == id ? updatedLead : l));

    // Try real VoIP API (only for DB-backed leads)
    if (!String(id).startsWith('L_') && !String(id).startsWith('EXT_')) {
      try {
        const r = await fetch('/api/call', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            phone: lead.phone,
            lead_id: id
          })
        });
        if (r.ok) {
          // Backend sent command to Moizvonki; poll for webhook callback + recording
          startCallPolling(id);
          return; // don't sync manually — polling will refresh
        }
      } catch (e) {/* VoIP not configured or network error — fall through */}
    }

    // Fallback: VoIP yo'q — calling statusini 'logged' ga o'zgartir va saqlash
    const finalLead = {
      ...updatedLead,
      chatLogs: updatedLead.chatLogs.map(lg => lg === callingLog ? {
        ...lg,
        status: 'logged',
        text: `📞 Chiquvchi qo'ng'iroq: ${lead.phone}`
      } : lg)
    };
    setLeads(prev => prev.map(l => l.id == id ? finalLead : l));
    setTimeout(() => syncLeadToAPI(finalLead), 100);
    setCallingLeadId(null);
  };
  const handleStatusChange = (leadId, newStatus) => {
    setHasUnsavedChanges(true);
    let targetLead = null;
    setLeads(prev => prev.map(l => {
      if (l.id == leadId) {
        targetLead = {
          ...l,
          status: newStatus,
          actualCallAttempts: 0,
          chatLogs: [...l.chatLogs, {
            type: 'sys',
            date: new Date().toISOString(),
            by: authUser.username,
            text: `🔄 Bosqich o'zgardi → ${newStatus}. Urinishlar nollashtirildi.`
          }]
        };
        return targetLead;
      }
      return l;
    }));
    if (targetLead) {
      setTimeout(() => syncLeadToAPI(targetLead), 100);
      if (newStatus === 'WON') addNotif('stage_changed', '🏆 Bitim yutildi!', `${targetLead.name} → WON bosqichiga o'tdi`, leadId);else if (newStatus === 'LOST') addNotif('stage_changed', '❌ Bitim yo\'qotildi', `${targetLead.name} → LOST bosqichiga o'tdi`, leadId);else addNotif('stage_changed', '🔄 Bosqich o\'zgardi', `${targetLead.name} → ${newStatus}`, leadId);
    }
  };
  const handleSendChatMsg = id => {
    if (!chatMessageInput.trim()) return;
    setHasUnsavedChanges(true);
    let targetLead = null;
    setLeads(prev => prev.map(l => {
      if (String(l.id) === String(id)) {
        targetLead = {
          ...l,
          chatLogs: [...l.chatLogs, {
            type: 'msg',
            dir: 'out',
            date: new Date().toISOString(),
            text: chatMessageInput
          }]
        };
        return targetLead;
      }
      return l;
    }));
    setChatMessageInput('');
    if (targetLead) setTimeout(() => syncLeadToAPI(targetLead), 100);
  };
  const handleDragStart = (e, leadId) => {
    e.dataTransfer.setData('leadId', String(leadId));
  };
  const handleDrop = (e, targetStatus) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('leadId');
    if (leadId) handleStatusChange(leadId, targetStatus);
  };
  const tabTitles = {
    dashboard: 'Boshqaruv paneli',
    leads: 'Sotuv Varonkasi',
    callcenter: 'Call Center',
    reports: 'Hisobotlar',
    marketing: 'Marketing Analitika',
    integrations: 'Integratsiyalar',
    settings: 'Sozlamalar'
  };

  // Filtered leads for search
  const filteredActiveLeads = searchQuery.trim() ? activeLeads.filter(l => l.name.toLowerCase().includes(searchQuery.toLowerCase()) || (l.phone || '').includes(searchQuery)) : activeLeads;
  return /*#__PURE__*/React.createElement("div", {
    className: "app-container"
  }, /*#__PURE__*/React.createElement("aside", {
    className: "sidebar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sidebar-brand"
  }, /*#__PURE__*/React.createElement("div", {
    className: "brand-icon"
  }, "M"), /*#__PURE__*/React.createElement("span", {
    className: "brand-name"
  }, "MIZON"), /*#__PURE__*/React.createElement("span", {
    className: "brand-role",
    style: role === 'WATCHER' ? {
      background: 'rgba(139,92,246,0.15)',
      color: '#8b5cf6',
      borderColor: 'rgba(139,92,246,0.3)'
    } : undefined
  }, role === 'WATCHER' ? 'KUZATUVCHI' : role)), /*#__PURE__*/React.createElement("nav", {
    className: "sidebar-nav"
  }, /*#__PURE__*/React.createElement("span", {
    className: "nav-section-label"
  }, "Asosiy"), /*#__PURE__*/React.createElement("div", {
    className: `nav-item ${activeTab === 'dashboard' ? 'active' : ''}`,
    onClick: () => {
      setActiveTab('dashboard');
      setSelectedLeadId(null);
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "chart",
    s: 17
  }), " Boshqaruv paneli"), /*#__PURE__*/React.createElement("div", {
    className: `nav-item ${activeTab === 'leads' ? 'active' : ''}`,
    onClick: () => {
      setActiveTab('leads');
      setSelectedLeadId(null);
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "funnel",
    s: 17
  }), " Sotuv Varonkasi"), /*#__PURE__*/React.createElement("div", {
    className: `nav-item ${activeTab === 'callcenter' ? 'active' : ''}`,
    onClick: () => {
      setActiveTab('callcenter');
      setSelectedLeadId(null);
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '18px',
      lineHeight: 1,
      flexShrink: 0
    }
  }, "call"), " Call Center"), (role === 'CEO' || role === 'WATCHER') && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "nav-section-label",
    style: {
      marginTop: '8px'
    }
  }, "Analitika"), /*#__PURE__*/React.createElement("div", {
    className: `nav-item ${activeTab === 'reports' ? 'active' : ''}`,
    onClick: () => {
      setActiveTab('reports');
      setSelectedLeadId(null);
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '18px',
      lineHeight: 1,
      flexShrink: 0
    }
  }, "bar_chart_4_bars"), " Hisobotlar")), role === 'CEO' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: `nav-item ${activeTab === 'marketing' ? 'active' : ''}`,
    onClick: () => {
      setActiveTab('marketing');
      setSelectedLeadId(null);
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '18px',
      lineHeight: 1,
      flexShrink: 0
    }
  }, "campaign"), " Marketing"), /*#__PURE__*/React.createElement("span", {
    className: "nav-section-label",
    style: {
      marginTop: '8px'
    }
  }, "Boshqaruv"), /*#__PURE__*/React.createElement("div", {
    className: `nav-item ${activeTab === 'automation' ? 'active' : ''}`,
    onClick: () => {
      setActiveTab('automation');
      setSelectedLeadId(null);
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '18px',
      lineHeight: 1,
      flexShrink: 0
    }
  }, "smart_toy"), " Avtomatizatsiya"), /*#__PURE__*/React.createElement("div", {
    className: `nav-item ${activeTab === 'integrations' ? 'active' : ''}`,
    onClick: () => {
      setActiveTab('integrations');
      setSelectedLeadId(null);
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "plug",
    s: 17
  }), " Integratsiyalar"), /*#__PURE__*/React.createElement("div", {
    className: `nav-item ${activeTab === 'settings' ? 'active' : ''}`,
    onClick: () => {
      setActiveTab('settings');
      setSelectedLeadId(null);
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "settings",
    s: 17
  }), " Sozlamalar"))), /*#__PURE__*/React.createElement("div", {
    className: "sidebar-footer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sidebar-user"
  }, /*#__PURE__*/React.createElement("div", {
    className: "avatar",
    style: {
      width: '34px',
      height: '34px',
      fontSize: '13px'
    }
  }, authUser.username[0].toUpperCase()), /*#__PURE__*/React.createElement("div", {
    className: "sidebar-user-info"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sidebar-user-name"
  }, authUser.username), /*#__PURE__*/React.createElement("div", {
    className: "sidebar-user-role"
  }, authUser.role))), /*#__PURE__*/React.createElement("div", {
    className: "nav-item",
    onClick: () => {
      clearCompanyCache();
      setAuthUser(null);
      localStorage.removeItem('mizon_session');
      localStorage.removeItem('mizon_token');
      localStorage.removeItem('mizon_callLimit');
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "logout",
    s: 16
  }), " Tizimdan chiqish"))), /*#__PURE__*/React.createElement("main", {
    className: "main-wrapper"
  }, /*#__PURE__*/React.createElement("header", {
    className: "topbar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "topbar-title"
  }, tabTitles[activeTab] || ''), /*#__PURE__*/React.createElement("div", {
    className: "topbar-right"
  }, activeTab === 'leads' && /*#__PURE__*/React.createElement("div", {
    className: "topbar-search"
  }, /*#__PURE__*/React.createElement("span", {
    className: "topbar-search-icon material-symbols-outlined",
    style: {
      fontSize: '17px'
    }
  }, "search"), /*#__PURE__*/React.createElement("input", {
    placeholder: "Qidirish...",
    value: searchQuery,
    onChange: e => setSearchQuery(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "notif-wrap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "icon-btn",
    onClick: () => setShowNotifPanel(p => !p),
    title: "Bildirishnomalar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '20px'
    }
  }, "notifications"), unreadCount > 0 && /*#__PURE__*/React.createElement("span", {
    className: "notif-badge"
  }, unreadCount > 9 ? '9+' : unreadCount)), showNotifPanel && /*#__PURE__*/React.createElement("div", {
    className: "notif-panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "notif-panel-head"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      fontSize: '14px'
    }
  }, "Bildirishnomalar"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px',
      alignItems: 'center'
    }
  }, unreadCount > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: markAllRead,
    style: {
      fontSize: '11px',
      background: 'none',
      border: 'none',
      color: 'var(--accent)',
      cursor: 'pointer',
      fontWeight: 600,
      padding: 0
    }
  }, "Barchasini o'qildi \u2713"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowNotifPanel(false),
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'var(--text-muted)',
      fontSize: '18px',
      lineHeight: 1,
      padding: '2px'
    }
  }, "\u2715"))), /*#__PURE__*/React.createElement("div", {
    className: "notif-list"
  }, notifications.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "notif-empty"
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '38px',
      opacity: 0.25,
      display: 'block',
      marginBottom: '8px'
    }
  }, "notifications_none"), "Bildirishnoma yo'q") : notifications.map(n => /*#__PURE__*/React.createElement("div", {
    key: n.id,
    className: `notif-item${n.read ? '' : ' unread'}`,
    onClick: () => {
      markRead(n.id);
      if (n.leadId) {
        setSelectedLeadId(n.leadId);
        setActiveTab('leads');
        setShowNotifPanel(false);
      }
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '18px',
      flexShrink: 0,
      lineHeight: 1.3
    }
  }, notifIcon(n.type)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: n.read ? 500 : 700,
      fontSize: '13px',
      marginBottom: '2px',
      lineHeight: 1.3
    }
  }, n.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      lineHeight: 1.5,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, n.body), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '10px',
      color: 'var(--text-muted)',
      marginTop: '4px',
      opacity: 0.7
    }
  }, timeAgo(n.createdAt))), !n.read && /*#__PURE__*/React.createElement("span", {
    style: {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      background: 'var(--accent)',
      flexShrink: 0,
      marginTop: '5px'
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      deleteNotif(n.id);
    },
    style: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'var(--text-muted)',
      fontSize: '15px',
      padding: '0 2px',
      opacity: 0,
      transition: 'opacity 0.15s',
      flexShrink: 0
    },
    onMouseEnter: e => e.currentTarget.style.opacity = '1',
    onMouseLeave: e => e.currentTarget.style.opacity = '0'
  }, "\u2715")))), notifications.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "notif-panel-foot"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (window.confirm("Barcha bildirishnomalarni o'chirish?")) setNotifications([]);
    },
    style: {
      fontSize: '11px',
      background: 'none',
      border: 'none',
      color: 'var(--danger)',
      cursor: 'pointer',
      fontWeight: 600
    }
  }, "\uD83D\uDDD1 Barchasini tozalash")))), /*#__PURE__*/React.createElement("button", {
    className: "icon-btn theme-btn",
    onClick: () => setDarkMode(!darkMode),
    title: darkMode ? 'Kunduzgi rejim' : 'Tungi rejim'
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '19px'
    }
  }, darkMode ? 'light_mode' : 'dark_mode')), /*#__PURE__*/React.createElement("div", {
    className: "avatar",
    style: {
      width: '32px',
      height: '32px',
      fontSize: '12px',
      cursor: 'default'
    },
    title: authUser.username
  }, authUser.username[0].toUpperCase()))), /*#__PURE__*/React.createElement("div", {
    className: "content-area",
    style: {
      position: 'relative'
    }
  }, selectedLeadId && selectedLeadData ? /*#__PURE__*/React.createElement("div", {
    className: "lead-panel-overlay"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lead-panel-header"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "avatar",
    style: {
      width: '42px',
      height: '42px',
      fontSize: '15px'
    }
  }, getInitials(selectedLeadData.name)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-label)'
    }
  }, "ID: ", selectedLeadData.id, " \xB7 ", selectedLeadData.owner), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '18px',
      fontWeight: 700
    }
  }, selectedLeadData.name)), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: '8px',
      fontSize: '11px',
      fontWeight: 700,
      padding: '3px 10px',
      borderRadius: '20px',
      background: (colColors[selectedLeadData.status] || '#888') + '22',
      color: colColors[selectedLeadData.status] || 'var(--text-muted)'
    }
  }, selectedLeadData.status)), syncStatus && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 12px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: 600,
      animation: syncStatus !== 'saving' ? `fadeInOut ${syncStatus === 'error' ? '4' : '2.5'}s ease forwards` : 'none',
      transition: 'all 0.2s',
      background: syncStatus === 'saving' ? 'rgba(245,158,11,0.1)' : syncStatus === 'saved' ? 'rgba(1,167,80,0.1)' : 'rgba(239,68,68,0.1)',
      border: `1px solid ${syncStatus === 'saving' ? 'rgba(245,158,11,0.35)' : syncStatus === 'saved' ? 'rgba(1,167,80,0.3)' : 'rgba(239,68,68,0.35)'}`,
      color: syncStatus === 'saving' ? '#f59e0b' : syncStatus === 'saved' ? '#01a750' : '#ef4444'
    }
  }, syncStatus === 'saving' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '14px',
      animation: 'spin 0.9s linear infinite'
    }
  }, "sync"), "Saqlanmoqda..."), syncStatus === 'saved' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '14px'
    }
  }, "check_circle"), "Saqlandi"), syncStatus === 'error' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '14px'
    }
  }, "error"), "Xato! Internet aloqasini tekshiring")), ['CEO', 'SUPERADMIN'].includes(role) && /*#__PURE__*/React.createElement("button", {
    className: "btn-danger",
    style: {
      marginRight: '8px'
    },
    onClick: () => handleDeleteLead(selectedLeadData.id)
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "delete",
    s: 14
  }), " Lidni o'chirish"), hasUnsavedChanges && role !== 'WATCHER' ? /*#__PURE__*/React.createElement("button", {
    className: "btn-success",
    onClick: () => {
      if (selectedLeadData) applyAuditAndSave(selectedLeadData, editLeadSnapshot);
      setEditingLead(false);
      setSelectedLeadId(null);
      setShowCompleteModal(false);
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "save",
    s: 14
  }), " Saqlash va Yopish") : /*#__PURE__*/React.createElement("button", {
    className: "btn-outline",
    onClick: () => {
      setEditingLead(false);
      setSelectedLeadId(null);
      setShowCompleteModal(false);
      setEditLeadSnapshot(null);
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "x",
    s: 14
  }), " Yopish")), /*#__PURE__*/React.createElement("div", {
    className: "lead-panel-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lead-profile-col"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "label-sm",
    style: {
      marginBottom: 0
    }
  }, "Mijoz ma'lumotlari"), role !== 'WATCHER' && /*#__PURE__*/React.createElement("button", {
    className: "btn-outline",
    style: {
      padding: '4px 10px',
      fontSize: '11px'
    },
    onClick: () => {
      if (editingLead && selectedLeadData) {
        applyAuditAndSave(selectedLeadData, editLeadSnapshot);
      } else if (!editingLead && selectedLeadData) {
        // Edit rejimiga kirish — asl nusxani saqlaymiz
        setEditLeadSnapshot({
          ...selectedLeadData
        });
      }
      setEditingLead(prev => !prev);
    }
  }, editingLead ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Ico, {
    n: "check",
    s: 12
  }), " Saqlash") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Ico, {
    n: "pencil",
    s: 12
  }), " Tahrirlash"))), editingLead && role !== 'WATCHER' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      marginBottom: '18px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Ism:"), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    value: selectedLeadData.name,
    onChange: e => {
      setHasUnsavedChanges(true);
      setLeads(prev => prev.map(l => l.id == selectedLeadId ? {
        ...l,
        name: e.target.value
      } : l));
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Telefon:"), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    value: selectedLeadData.phone,
    onChange: e => {
      setHasUnsavedChanges(true);
      setLeads(prev => prev.map(l => l.id == selectedLeadId ? {
        ...l,
        phone: e.target.value
      } : l));
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Manzil:"), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    value: selectedLeadData.region,
    onChange: e => {
      setHasUnsavedChanges(true);
      setLeads(prev => prev.map(l => l.id == selectedLeadId ? {
        ...l,
        region: e.target.value
      } : l));
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Manba:"), /*#__PURE__*/React.createElement("select", {
    className: "input-base",
    value: selectedLeadData.source,
    onChange: e => {
      setHasUnsavedChanges(true);
      setLeads(prev => prev.map(l => l.id == selectedLeadId ? {
        ...l,
        source: e.target.value
      } : l));
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "meta_fb_ads"
  }, "Facebook Lead Ads"), /*#__PURE__*/React.createElement("option", {
    value: "telegram_bot"
  }, "Telegram Bot"), /*#__PURE__*/React.createElement("option", {
    value: "phone_call"
  }, "Telefon"), /*#__PURE__*/React.createElement("option", {
    value: "referral"
  }, "Tavsiya"), /*#__PURE__*/React.createElement("option", {
    value: "website"
  }, "Veb-sayt"), /*#__PURE__*/React.createElement("option", {
    value: "manual"
  }, "Qo'lda kiritilgan")), /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Mas'ul xodim:"), /*#__PURE__*/React.createElement("select", {
    className: "input-base",
    value: selectedLeadData.owner,
    onChange: e => {
      setHasUnsavedChanges(true);
      setLeads(prev => prev.map(l => l.id == selectedLeadId ? {
        ...l,
        owner: e.target.value
      } : l));
    }
  }, users.map(u => /*#__PURE__*/React.createElement("option", {
    key: u.username,
    value: u.username
  }, u.username, " (", u.role, ")"))), cardFields.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--border-light)',
      paddingTop: '8px',
      marginTop: '4px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Qo'shimcha ma'lumotlar"), cardFields.map(cf => /*#__PURE__*/React.createElement("div", {
    key: cf.id
  }, /*#__PURE__*/React.createElement("span", {
    className: "label-sm",
    style: {
      fontSize: '11px'
    }
  }, cf.label, ":"), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    type: cf.type || 'text',
    placeholder: cf.placeholder || '',
    value: (selectedLeadData.customData || {})[cf.key] || '',
    onChange: e => {
      setHasUnsavedChanges(true);
      setLeads(prev => prev.map(l => l.id == selectedLeadId ? {
        ...l,
        customData: {
          ...(l.customData || {}),
          [cf.key]: e.target.value
        }
      } : l));
    }
  }))))) : /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '18px'
    }
  }, [{
    icon: 'call',
    label: 'Telefon',
    value: selectedLeadData.phone
  }, {
    icon: 'location_on',
    label: 'Manzil',
    value: selectedLeadData.region
  }, {
    icon: 'person',
    label: 'Mas\'ul',
    value: selectedLeadData.owner
  }].map(row => /*#__PURE__*/React.createElement("div", {
    key: row.label,
    className: "info-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "info-row-icon"
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '15px'
    }
  }, row.icon)), /*#__PURE__*/React.createElement("span", {
    className: "info-label"
  }, row.label), /*#__PURE__*/React.createElement("span", {
    className: "info-value"
  }, row.value))), /*#__PURE__*/React.createElement("div", {
    className: "info-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "info-row-icon"
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '15px'
    }
  }, "label")), /*#__PURE__*/React.createElement("span", {
    className: "info-label"
  }, "Manba"), /*#__PURE__*/React.createElement("span", {
    className: "info-value"
  }, /*#__PURE__*/React.createElement("span", {
    className: `source-badge badge-${selectedLeadData.source}`
  }, selectedLeadData.source.replace('meta_', '')))), cardFields.filter(cf => (selectedLeadData.customData || {})[cf.key]).map(cf => /*#__PURE__*/React.createElement("div", {
    key: cf.id,
    className: "info-row"
  }, /*#__PURE__*/React.createElement("div", {
    className: "info-row-icon"
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '15px'
    }
  }, "more_horiz")), /*#__PURE__*/React.createElement("span", {
    className: "info-label"
  }, cf.label), /*#__PURE__*/React.createElement("span", {
    className: "info-value"
  }, (selectedLeadData.customData || {})[cf.key])))), selectedLeadData.deadline && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Faol Vazifa"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px',
      borderRadius: '8px',
      marginBottom: '16px',
      background: determineSLAType(selectedLeadData.deadline) === 'danger' ? 'var(--danger-bg)' : determineSLAType(selectedLeadData.deadline) === 'warning' ? 'var(--warning-bg)' : 'var(--bg-base)',
      border: `1px solid ${determineSLAType(selectedLeadData.deadline) === 'danger' ? 'rgba(255,180,171,0.5)' : determineSLAType(selectedLeadData.deadline) === 'warning' ? 'rgba(245,158,11,0.5)' : 'var(--border-light)'}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '11px',
      color: 'rgba(255,255,255,0.65)',
      textTransform: 'uppercase',
      marginBottom: '2px'
    }
  }, "Muddat:"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      fontWeight: 600,
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "clock",
    s: 13
  }), " ", new Date(selectedLeadData.deadline).toLocaleString()), selectedLeadData.taskAssignee && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '11px',
      color: 'rgba(255,255,255,0.55)',
      marginTop: '2px'
    }
  }, "\uD83D\uDC64 ", selectedLeadData.taskAssignee))), /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Qo'ng'iroq"), role === 'WATCHER' ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 12px',
      marginBottom: '14px',
      fontSize: '12px',
      color: 'var(--text-muted)',
      background: 'var(--bg-hover)',
      borderRadius: '8px',
      border: '1px solid var(--border-light)'
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "phone",
    s: 13
  }), " ", selectedLeadData.actualCallAttempts, " ta qo'ng'iroq qayd etilgan") : callingLeadId === String(selectedLeadData.id) ? /*#__PURE__*/React.createElement("button", {
    className: "btn-primary",
    style: {
      width: '100%',
      marginBottom: '14px',
      opacity: 0.85,
      cursor: 'not-allowed'
    },
    disabled: true
  }, /*#__PURE__*/React.createElement("span", {
    className: "calling-ring"
  }, "\uD83D\uDCDE"), " Qo'ng'iroq amalga oshirilmoqda...") : /*#__PURE__*/React.createElement("button", {
    className: "btn-outline",
    style: {
      width: '100%',
      marginBottom: '14px'
    },
    onClick: () => handleLogCall(selectedLeadData.id)
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "phone",
    s: 14
  }), " Qo'ng'iroq (", selectedLeadData.actualCallAttempts, " / ", globalCallLimit, ")"), /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Bosqich"), role === 'WATCHER' ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 12px',
      fontSize: '12px',
      color: 'var(--text-secondary)',
      background: 'var(--bg-hover)',
      borderRadius: '8px',
      border: '1px solid var(--border-light)'
    }
  }, columnsMap[selectedLeadData.pipelineId]?.find(c => c.id === selectedLeadData.status)?.title || selectedLeadData.status) : /*#__PURE__*/React.createElement("select", {
    className: "input-base",
    value: selectedLeadData.status,
    onChange: e => handleStatusChange(selectedLeadData.id, e.target.value)
  }, columnsMap[selectedLeadData.pipelineId]?.map(c => /*#__PURE__*/React.createElement("option", {
    key: c.id,
    value: c.id
  }, c.title)))), /*#__PURE__*/React.createElement("div", {
    className: "lead-chat-col"
  }, /*#__PURE__*/React.createElement("div", {
    className: "operator-bar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "online-dot"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-secondary)'
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--accent)'
    }
  }, authUser.username), " hozir bu oynada ishlayapti"), selectedLeadData.owner !== authUser.username && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      background: 'rgba(245,158,11,0.12)',
      border: '1px solid rgba(245,158,11,0.3)',
      color: '#f59e0b',
      padding: '2px 8px',
      borderRadius: '10px',
      fontSize: '11px'
    }
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "alert",
    s: 10
  }), " Mas'ul: ", selectedLeadData.owner)), /*#__PURE__*/React.createElement("div", {
    className: "chat-logs-area"
  }, selectedLeadData.chatLogs.map((log, idx) => {
    // ---- VoIP call log ----
    if (log.type === 'call') {
      const isCalling = log.status === 'calling';
      const hasRecord = !!log.record_url;
      const dur = log.duration > 0 ? ` · ${Math.floor(log.duration / 60)}:${String(log.duration % 60).padStart(2, '0')}` : '';
      const bgColor = hasRecord ? 'rgba(1,167,80,0.1)' : isCalling ? 'rgba(90,223,129,0.06)' : 'rgba(255,255,255,0.04)';
      const bdColor = hasRecord ? 'rgba(1,167,80,0.3)' : isCalling ? 'rgba(90,223,129,0.3)' : 'var(--border-light)';
      const iconEmoji = hasRecord ? '🎙' : isCalling ? '📞' : log.text.includes('iruvchi') ? '📲' : '📞';
      const cleanText = log.text.replace(/^[📞📲🎙]\s*/, '');
      return /*#__PURE__*/React.createElement("div", {
        key: idx,
        style: {
          display: 'flex',
          justifyContent: 'center',
          margin: '2px 0'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "call-log-bubble",
        style: {
          background: bgColor,
          border: `1px solid ${bdColor}`,
          width: '100%'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          width: '34px',
          height: '34px',
          borderRadius: '50%',
          flexShrink: 0,
          background: hasRecord ? 'rgba(1,167,80,0.18)' : 'rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: isCalling ? 'calling-ring' : ''
      }, iconEmoji)), /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1,
          minWidth: 0
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-main)',
          lineHeight: 1.35,
          wordBreak: 'break-word'
        }
      }, cleanText), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '11px',
          color: 'var(--text-muted)',
          marginTop: '2px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }
      }, /*#__PURE__*/React.createElement("span", null, new Date(log.date).toLocaleTimeString(), dur), isCalling && /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--primary)',
          animation: 'callPulse 1s infinite'
        }
      }, "\u25CF Jonli qo'ng'iroq..."), hasRecord && /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--success)'
        }
      }, "\u25CF Yozuv mavjud")))), hasRecord && /*#__PURE__*/React.createElement("div", {
        style: {
          marginTop: '8px'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '11px',
          color: 'var(--text-muted)',
          marginBottom: '4px',
          fontWeight: 500
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "material-symbols-outlined",
        style: {
          fontSize: '13px',
          verticalAlign: 'middle'
        }
      }, "mic"), " Qo'ng'iroq yozuvi"), /*#__PURE__*/React.createElement("audio", {
        controls: true,
        style: {
          width: '100%',
          height: '32px',
          borderRadius: '4px'
        },
        src: log.record_url
      }, /*#__PURE__*/React.createElement("a", {
        href: log.record_url,
        target: "_blank",
        rel: "noopener",
        style: {
          color: 'var(--primary)',
          fontSize: '12px'
        }
      }, "\u2197 Yozuvni yuklab olish")))));
    }
    // ---- Audit log (o'zgarishlar — oddiy sys sifatida) ----
    if (log.type === 'audit') {
      const byMatch = log.text.match(/^✏️\s+(.+?)\s+o['']zgartirdi:\s*/);
      const by = byMatch ? byMatch[1] : log.by || '?';
      const details = byMatch ? log.text.slice(byMatch[0].length) : log.text;
      return /*#__PURE__*/React.createElement("div", {
        key: idx,
        className: "sys-log",
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, "\u270F\uFE0F ", /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--primary)',
          fontWeight: 600
        }
      }, by), ": ", details.replace(/ \| /g, ' · ')), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '10px',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          flexShrink: 0
        }
      }, new Date(log.date).toLocaleTimeString()));
    }
    // ---- Vazifa karta (sys + isTask) ----
    const isTaskLog = log.type === 'sys' && (log.isTask || log.text && (log.text.startsWith('📌') || log.text.includes('Vazifa ochildi') || log.text.includes('Vazifa belgilandi')));
    if (isTaskLog) {
      // Bu vazifa keyinchalik yakunlanganmi? idx dan keyin '✅' yozuvi bor bo'lsa — yakunlangan
      const completedAfter = selectedLeadData.chatLogs.slice(idx + 1).some(lg => lg.type === 'sys' && lg.text && lg.text.startsWith('✅'));
      const taskStillActive = !!selectedLeadData.deadline && !completedAfter;
      const isCompleting = inlineCompleteId === idx;
      return /*#__PURE__*/React.createElement("div", {
        key: idx,
        style: {
          padding: '10px 14px',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: '10px'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "material-symbols-outlined",
        style: {
          fontSize: '16px',
          color: '#f59e0b',
          flexShrink: 0,
          marginTop: '1px'
        }
      }, "task_alt"), /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1,
          minWidth: 0
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '11px',
          fontWeight: 700,
          color: '#f59e0b'
        }
      }, "Vazifa belgilandi"), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '10px',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          flexShrink: 0
        }
      }, log.by && /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--primary)',
          fontWeight: 600
        }
      }, log.by, " \xB7 "), new Date(log.date).toLocaleTimeString())), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '12px',
          color: 'var(--text-main)',
          lineHeight: 1.4,
          marginTop: '3px'
        }
      }, taskStillActive ? selectedLeadData.taskDescription : log.text.replace(/^📌 Vazifa:\s*/, '')), taskStillActive && selectedLeadData.deadline && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '10px',
          color: 'var(--text-muted)',
          marginTop: '3px'
        }
      }, "\u23F0 ", new Date(selectedLeadData.deadline).toLocaleString('uz-UZ', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })), log.assignee && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '10px',
          color: 'var(--text-muted)',
          marginTop: '2px'
        }
      }, "\uD83D\uDC64 ", log.assignee), taskStillActive && role !== 'WATCHER' && !isCompleting && /*#__PURE__*/React.createElement("button", {
        className: "btn-success",
        style: {
          marginTop: '8px',
          fontSize: '11px',
          padding: '5px 12px'
        },
        onClick: () => {
          setInlineCompleteId(idx);
          setInlineCompleteNote('');
        }
      }, "\u2713 Vazifani yakunlash"), isCompleting && /*#__PURE__*/React.createElement("div", {
        style: {
          marginTop: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }
      }, /*#__PURE__*/React.createElement("input", {
        className: "input-base",
        style: {
          marginBottom: 0,
          fontSize: '12px'
        },
        placeholder: "Natija: Shartnoma imzolandi...",
        value: inlineCompleteNote,
        autoFocus: true,
        onChange: e => setInlineCompleteNote(e.target.value)
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '6px'
        }
      }, /*#__PURE__*/React.createElement("button", {
        className: "btn-success",
        style: {
          flex: 1,
          fontSize: '11px'
        },
        onClick: () => handleTaskComplete(selectedLeadData.id, inlineCompleteNote)
      }, "Tasdiqlash"), /*#__PURE__*/React.createElement("button", {
        className: "btn-outline",
        style: {
          padding: '0 10px',
          fontSize: '11px'
        },
        onClick: () => setInlineCompleteId(null)
      }, "Bekor"))))));
    }
    // ---- System log ----
    if (log.type === 'sys') return /*#__PURE__*/React.createElement("div", {
      key: idx,
      className: "sys-log",
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("span", null, log.text), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '10px',
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
        flexShrink: 0
      }
    }, log.by && /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--primary)',
        fontWeight: 600
      }
    }, log.by, " \xB7 "), new Date(log.date).toLocaleTimeString()));
    // ---- Telegram / Instagram message ----
    if (log.type === 'telegram' || log.type === 'instagram') {
      const icon = log.type === 'telegram' ? '✈️' : '📸';
      return /*#__PURE__*/React.createElement("div", {
        key: idx,
        className: "sys-log",
        style: {
          background: 'rgba(0,136,204,0.06)',
          border: '1px solid rgba(0,136,204,0.15)',
          borderRadius: '6px',
          padding: '5px 10px',
          textAlign: 'left'
        }
      }, icon, " ", log.text, " ", /*#__PURE__*/React.createElement("span", {
        style: {
          float: 'right',
          fontSize: '10px',
          color: 'var(--text-muted)'
        }
      }, new Date(log.date).toLocaleTimeString()));
    }
    // ---- Chat message ----
    return /*#__PURE__*/React.createElement("div", {
      key: idx,
      className: `msg-bubble ${log.dir === 'in' ? 'msg-in' : 'msg-out'}`
    }, log.text);
  })), role !== 'WATCHER' && /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--outline-variant)',
      background: 'var(--bg-surface)',
      flexShrink: 0
    }
  }, showTaskInput && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 14px',
      borderBottom: '1px solid var(--outline-variant)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '11px',
      fontWeight: 700,
      color: '#f59e0b',
      marginBottom: '8px',
      display: 'flex',
      alignItems: 'center',
      gap: '5px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "material-symbols-outlined",
    style: {
      fontSize: '14px'
    }
  }, "task_alt"), " Vazifa belgilash"), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    style: {
      marginBottom: '6px',
      fontSize: '12px'
    },
    placeholder: "Vazifa tavsifi...",
    value: taskDescInput,
    onChange: e => setTaskDescInput(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '6px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    className: "input-base",
    style: {
      marginBottom: 0,
      fontSize: '12px',
      flex: 1
    },
    min: new Date().toISOString().split('T')[0],
    value: taskDateInput ? taskDateInput.split('T')[0] : '',
    onChange: e => {
      const t = taskDateInput ? taskDateInput.split('T')[1] || '09:00' : '09:00';
      setTaskDateInput(e.target.value + 'T' + t);
    }
  }), /*#__PURE__*/React.createElement("input", {
    type: "time",
    className: "input-base",
    style: {
      marginBottom: 0,
      fontSize: '12px',
      flex: 1
    },
    value: taskDateInput ? taskDateInput.split('T')[1] || '' : '',
    onChange: e => {
      const d = taskDateInput ? taskDateInput.split('T')[0] : new Date().toISOString().split('T')[0];
      setTaskDateInput(d + 'T' + e.target.value);
    }
  })), /*#__PURE__*/React.createElement("select", {
    className: "input-base",
    style: {
      marginBottom: '8px',
      fontSize: '12px'
    },
    value: taskAssignee,
    onChange: e => setTaskAssignee(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\uD83D\uDC64 Kim uchun? (", authUser.username, ")"), users.map(u => /*#__PURE__*/React.createElement("option", {
    key: u.username,
    value: u.username
  }, u.full_name || u.username))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn-primary",
    style: {
      flex: 1,
      fontSize: '12px'
    },
    onClick: () => handleTaskCreate(selectedLeadData.id)
  }, "\uD83D\uDCCC Belgilash"), /*#__PURE__*/React.createElement("button", {
    className: "btn-outline",
    style: {
      padding: '0 12px',
      fontSize: '12px'
    },
    onClick: () => setShowTaskInput(false)
  }, "Bekor"))), /*#__PURE__*/React.createElement("div", {
    className: "chat-input-area"
  }, /*#__PURE__*/React.createElement("button", {
    title: "Vazifa qo'shish",
    style: {
      background: 'none',
      border: '1px solid var(--outline-variant)',
      borderRadius: '8px',
      padding: '5px 9px',
      cursor: 'pointer',
      color: showTaskInput ? 'var(--primary)' : 'var(--text-muted)',
      fontSize: '18px',
      lineHeight: 1,
      flexShrink: 0,
      transition: 'color 0.15s'
    },
    onClick: () => setShowTaskInput(p => !p)
  }, showTaskInput ? '✕' : '+'), /*#__PURE__*/React.createElement("input", {
    id: "chatMessageInputBox",
    className: "input-base",
    style: {
      marginBottom: 0
    },
    placeholder: "Izoh yoki qayd yozib qoldirish...",
    value: chatMessageInput,
    onChange: e => setChatMessageInput(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') handleSendChatMsg(selectedLeadData.id);
    }
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn-primary",
    onClick: () => handleSendChatMsg(selectedLeadData.id)
  }, "Yuborish")))))) : null, showAddLead && /*#__PURE__*/React.createElement("div", {
    className: "login-overlay",
    onClick: e => {
      if (e.target === e.currentTarget) setShowAddLead(false);
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "login-box",
    style: {
      width: '420px'
    },
    onKeyDown: e => {
      if (e.key === 'Enter' && newLeadForm.name && newLeadForm.phone) {
        e.preventDefault();
        handleAddManualLead();
      }
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      marginBottom: '20px',
      letterSpacing: '-0.4px',
      fontSize: '18px',
      fontWeight: 700
    }
  }, "Yangi Lead Qo'shish"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Ism-familiya *"), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    autoFocus: true,
    placeholder: "Sardor Odilov",
    value: newLeadForm.name,
    onChange: e => setNewLeadForm({
      ...newLeadForm,
      name: e.target.value
    })
  }), /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Telefon *"), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    placeholder: "+998 XX XXX XX XX",
    value: newLeadForm.phone,
    onChange: e => setNewLeadForm({
      ...newLeadForm,
      phone: e.target.value
    })
  }), /*#__PURE__*/React.createElement("span", {
    className: "label-sm"
  }, "Manzil"), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    placeholder: "Toshkent, Yunusobod...",
    value: newLeadForm.region,
    onChange: e => setNewLeadForm({
      ...newLeadForm,
      region: e.target.value
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      marginTop: '16px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn-primary",
    style: {
      flex: 1
    },
    onClick: handleAddManualLead
  }, "Qo'shish"), /*#__PURE__*/React.createElement("button", {
    className: "btn-outline",
    onClick: () => setShowAddLead(false)
  }, "Bekor")))), activeTab === 'dashboard' && /*#__PURE__*/React.createElement(DashboardOverview, {
    leads: leads,
    role: role,
    setSelectedLeadId: setSelectedLeadId
  }), activeTab === 'callcenter' && /*#__PURE__*/React.createElement(CallCenterModule, {
    leads: leads,
    setLeads: setLeads,
    globalCallLimit: globalCallLimit,
    setSelectedLeadId: setSelectedLeadId,
    syncLeadToAPI: syncLeadToAPI,
    addNotif: addNotif,
    voipConfigured: voipConfigured
  }), activeTab === 'reports' && (role === 'CEO' || role === 'WATCHER') && /*#__PURE__*/React.createElement(HisobotlarModule, {
    leads: leads,
    columnsMap: columnsMap,
    pipelines: pipelines,
    setSelectedLeadId: setSelectedLeadId
  }), activeTab === 'automation' && role === 'CEO' && /*#__PURE__*/React.createElement(AutomationModule, {
    getAuthHeaders: getAuthHeaders
  }), activeTab === 'marketing' && role === 'CEO' && /*#__PURE__*/React.createElement(MarketingModule, null), activeTab === 'integrations' && /*#__PURE__*/React.createElement(IntegrationsModule, {
    formSettings: formSettings,
    setFormSettings: setFormSettings,
    formFields: formFields,
    setFormFields: setFormFields
  }), activeTab === 'leads' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pipeline-header"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: '18px',
      fontWeight: 700,
      letterSpacing: '-0.4px'
    }
  }, "Sotuv Varonkasi"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '12px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("select", {
    className: "pipeline-selector",
    value: activePipe,
    onChange: e => setActivePipe(e.target.value)
  }, pipelines.map(p => /*#__PURE__*/React.createElement("option", {
    key: p.id,
    value: p.id
  }, p.name))), role !== 'WATCHER' && /*#__PURE__*/React.createElement("button", {
    className: "btn-primary",
    onClick: () => setShowAddLead(true)
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "plus",
    s: 14
  }), " Yangi Lead"))), /*#__PURE__*/React.createElement("div", {
    className: "kanban-board"
  }, activeColumns.map(col => {
    const colLeads = filteredActiveLeads.filter(l => l.status === col.id);
    const dotColor = colColors[col.id] || '#888';
    return /*#__PURE__*/React.createElement("div", {
      key: col.id,
      className: "kanban-col",
      onDragOver: role !== 'WATCHER' ? e => e.preventDefault() : undefined,
      onDrop: role !== 'WATCHER' ? e => handleDrop(e, col.id) : undefined
    }, /*#__PURE__*/React.createElement("div", {
      className: "kanban-col-header"
    }, /*#__PURE__*/React.createElement("span", {
      className: "kanban-col-title"
    }, /*#__PURE__*/React.createElement("span", {
      className: "col-dot",
      style: {
        background: dotColor
      }
    }), col.title), /*#__PURE__*/React.createElement("span", {
      className: "kanban-col-count"
    }, colLeads.length)), /*#__PURE__*/React.createElement("div", {
      className: "kanban-cards"
    }, colLeads.map(lead => {
      const sla = determineSLAType(lead.deadline);
      const hasTask = lead.deadline || lead.taskDescription;
      let customClass = '';
      if (sla === 'danger') customClass = 'status-danger';else if (sla === 'warning') customClass = 'status-warning';else if (!hasTask && !['NEW', 'LOST', 'WON'].includes(lead.status)) customClass = 'needs-attention';
      return /*#__PURE__*/React.createElement("div", {
        key: lead.id,
        className: `k-card ${customClass}`,
        style: {
          borderLeftColor: customClass ? undefined : dotColor
        },
        draggable: role !== 'WATCHER',
        onDragStart: role !== 'WATCHER' ? e => handleDragStart(e, lead.id) : undefined,
        onClick: () => setSelectedLeadId(lead.id)
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '8px'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: `source-badge badge-${lead.source}`
      }, lead.source.replace('meta_', '')), sla === 'danger' && /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '10px',
          background: 'rgba(255,180,171,0.15)',
          color: 'var(--danger)',
          padding: '2px 6px',
          borderRadius: '4px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '3px'
        }
      }, /*#__PURE__*/React.createElement(Ico, {
        n: "alarm",
        s: 10
      }), " KECHIKDI"), sla === 'warning' && /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '10px',
          background: 'rgba(245,158,11,0.15)',
          color: 'var(--warning)',
          padding: '2px 6px',
          borderRadius: '4px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: '3px'
        }
      }, /*#__PURE__*/React.createElement(Ico, {
        n: "clock",
        s: 10
      }), " TEZ ORADA")), /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 600,
          fontSize: '14px',
          color: 'var(--text-main)',
          marginBottom: '4px',
          lineHeight: 1.3
        }
      }, lead.name), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }
      }, /*#__PURE__*/React.createElement(Ico, {
        n: "phone",
        s: 11
      }), " ", lead.actualCallAttempts, " urinish", /*#__PURE__*/React.createElement("span", {
        style: {
          width: '3px',
          height: '3px',
          borderRadius: '50%',
          background: 'var(--text-muted)',
          display: 'inline-block'
        }
      }), /*#__PURE__*/React.createElement(Ico, {
        n: "user",
        s: 11
      }), " ", lead.owner), lead.taskDescription || lead.deadline ? /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '11px',
          background: 'rgba(255,255,255,0.04)',
          padding: '5px 8px',
          borderRadius: '5px',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--text-secondary)'
        }
      }, lead.taskDescription ? /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(Ico, {
        n: "message",
        s: 10
      }), " ", lead.taskDescription.substring(0, 32), "...") : /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)'
        }
      }, /*#__PURE__*/React.createElement(Ico, {
        n: "clock",
        s: 10
      }), " Muddat belgilangan")) : !['NEW', 'LOST', 'WON'].includes(lead.status) && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '10px',
          background: 'rgba(255,180,171,0.08)',
          color: 'var(--danger)',
          padding: '4px 7px',
          borderRadius: '4px',
          border: '1px solid rgba(255,180,171,0.25)',
          fontWeight: 700
        }
      }, /*#__PURE__*/React.createElement(Ico, {
        n: "alert",
        s: 10
      }), " Vazifa belgilanmagan!"));
    })));
  }))), activeTab === 'settings' && role === 'CEO' && /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '780px',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "settings-tab-bar"
  }, /*#__PURE__*/React.createElement("div", {
    className: `settings-tab ${settingsActiveTab === 'users' ? 'active' : ''}`,
    onClick: () => setSettingsActiveTab('users')
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "users",
    s: 14
  }), " Xodimlar"), /*#__PURE__*/React.createElement("div", {
    className: `settings-tab ${settingsActiveTab === 'limits' ? 'active' : ''}`,
    onClick: () => setSettingsActiveTab('limits')
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "settings",
    s: 14
  }), " Sozlamalar"), /*#__PURE__*/React.createElement("div", {
    className: `settings-tab ${settingsActiveTab === 'pipelines' ? 'active' : ''}`,
    onClick: () => setSettingsActiveTab('pipelines')
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "layers",
    s: 14
  }), " Varonkalar"), /*#__PURE__*/React.createElement("div", {
    className: `settings-tab ${settingsActiveTab === 'cardfields' ? 'active' : ''}`,
    onClick: () => setSettingsActiveTab('cardfields')
  }, /*#__PURE__*/React.createElement(Ico, {
    n: "list",
    s: 14
  }), " Karta Maydonlari")), /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: {
      minHeight: '400px'
    }
  }, settingsActiveTab === 'users' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    style: {
      marginBottom: '14px',
      fontWeight: 600
    }
  }, "Tizim Xodimlari"), /*#__PURE__*/React.createElement(UserManagement, {
    users: users,
    setUsers: setUsers
  })), settingsActiveTab === 'limits' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    style: {
      marginBottom: '14px',
      fontWeight: 600
    }
  }, "Global Ko'rsatkichlar"), /*#__PURE__*/React.createElement(GlobalLimitsConfig, {
    globalCallLimit: globalCallLimit,
    setGlobalCallLimit: setGlobalCallLimit
  })), settingsActiveTab === 'pipelines' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    style: {
      marginBottom: '14px',
      fontWeight: 600
    }
  }, "Varonkalarni Sozlash"), /*#__PURE__*/React.createElement(PipelineEditor, {
    pipelines: pipelines,
    setPipelines: setPipelines,
    columnsMap: columnsMap,
    setColumnsMap: setColumnsMap,
    stageMapRef: stageMapRef,
    onStagesUpdated: reloadLeadsFromApi
  })), settingsActiveTab === 'cardfields' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    style: {
      marginBottom: '6px',
      fontWeight: 600
    }
  }, "Mijoz Kartasi Maydonlari"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: '12px',
      color: 'var(--text-muted)',
      marginBottom: '14px'
    }
  }, "Har bir mijoz kartasida ko'rinadigan qo'shimcha ma'lumot maydonlarini sozlang. Misol: Byudjet, Kompaniya, Mahsulot va h.k."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '7px',
      marginBottom: '16px'
    }
  }, cardFields.map((cf, idx) => /*#__PURE__*/React.createElement("div", {
    key: cf.id,
    style: {
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      padding: '10px',
      background: 'var(--bg-base)',
      border: '1px solid var(--border-light)',
      borderRadius: '8px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontSize: '12px',
      width: '20px'
    }
  }, idx + 1), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    style: {
      marginBottom: 0,
      flex: 2
    },
    placeholder: "Maydon nomi (masalan: Byudjet)",
    value: cf.label,
    onChange: e => setCardFields(cardFields.map(x => x.id === cf.id ? {
      ...x,
      label: e.target.value
    } : x))
  }), /*#__PURE__*/React.createElement("input", {
    className: "input-base",
    style: {
      marginBottom: 0,
      flex: 1
    },
    placeholder: "kalit (key)",
    value: cf.key,
    onChange: e => setCardFields(cardFields.map(x => x.id === cf.id ? {
      ...x,
      key: e.target.value.replace(/\s/g, '_')
    } : x))
  }), /*#__PURE__*/React.createElement("select", {
    className: "input-base",
    style: {
      marginBottom: 0,
      width: '90px'
    },
    value: cf.type || 'text',
    onChange: e => setCardFields(cardFields.map(x => x.id === cf.id ? {
      ...x,
      type: e.target.value
    } : x))
  }, /*#__PURE__*/React.createElement("option", {
    value: "text"
  }, "Matn"), /*#__PURE__*/React.createElement("option", {
    value: "number"
  }, "Raqam"), /*#__PURE__*/React.createElement("option", {
    value: "tel"
  }, "Telefon"), /*#__PURE__*/React.createElement("option", {
    value: "email"
  }, "Email"), /*#__PURE__*/React.createElement("option", {
    value: "url"
  }, "URL")), /*#__PURE__*/React.createElement("button", {
    className: "btn-danger",
    style: {
      padding: '4px 8px'
    },
    onClick: () => setCardFields(cardFields.filter(x => x.id !== cf.id))
  }, "\xD7"))), /*#__PURE__*/React.createElement("button", {
    className: "btn-outline",
    onClick: () => setCardFields([...cardFields, {
      id: 'cf_' + Date.now(),
      label: '',
      key: 'field_' + Date.now(),
      type: 'text',
      placeholder: ''
    }])
  }, "+ Yangi maydon qo'shish")), cardFields.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px',
      textAlign: 'center',
      color: 'var(--text-muted)',
      background: 'var(--bg-base)',
      borderRadius: '8px',
      border: '1px dashed var(--border-light)'
    }
  }, "Hali hech qanday maxsus maydon qo'shilmagan. Yuqoridagi tugmani bosing.")))))));
};
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(/*#__PURE__*/React.createElement(App, null));
