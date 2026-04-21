// Theme Toggle Logic
const themeToggleBtn = document.getElementById('themeToggle');
const sunIcon = document.getElementById('sun-icon');
const moonIcon = document.getElementById('moon-icon');
const htmlEl = document.documentElement;

// Load theme from localStorage or default to dark
let currentTheme = localStorage.getItem('mizon_theme') || 'dark';
htmlEl.setAttribute('data-theme', currentTheme);
updateThemeIcons();

themeToggleBtn.addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  htmlEl.setAttribute('data-theme', currentTheme);
  localStorage.setItem('mizon_theme', currentTheme);
  updateThemeIcons();
});

function updateThemeIcons() {
  if (currentTheme === 'dark') {
    moonIcon.style.display = 'none';
    sunIcon.style.display = 'block';
  } else {
    moonIcon.style.display = 'block';
    sunIcon.style.display = 'none';
  }
}

// Modal Logic
const leadModalOverlay = document.getElementById('leadModalOverlay');

function openModal() {
  leadModalOverlay.classList.add('active');
}

function closeModal() {
  leadModalOverlay.classList.remove('active');
}

// Kanban and Data Fetching
const API_URL = '/api/leads';
let state = {
  stages: [],
  leads: []
};

async function fetchData() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error('API down');
    const data = await res.json();
    if (data.success) {
      state.stages = data.stages;
      state.leads = data.leads;
      renderKanban();
    }
  } catch (err) {
    console.warn('Backend API topilmadi, demo xatosiz ishlashi uchun Local mock datadan render qilinmoqda...');
    
    // Fallback Mock Data for UI demonstration
    state.stages = [
      { id: 1, name: "Yangi Lead", sequence: 1 },
      { id: 2, name: "Aloqaga chiqildi", sequence: 2 },
      { id: 3, name: "Ehtiyoj aniqlandi", sequence: 3 },
      { id: 4, name: "Taklif yuborildi", sequence: 4 },
      { id: 5, name: "Muzokaralar", sequence: 5 },
      { id: 6, name: "Yutildi", sequence: 6 }
    ];
    
    // Check if we have local leads first, otherwise default
    if (state.leads.length === 0) {
      state.leads = [
        { id: 101, name: "Oshxona mebeli Xaridi", contact_name: "Aziza", phone: "+998901112233", stage_id: 1, mizon_source: "meta_fb_ads", lead_score: 50 },
        { id: 102, name: "Yotoqxona to'plami so'rovi", contact_name: "Umid", phone: "+998991234567", stage_id: 2, mizon_source: "telegram_bot", lead_score: 40 },
        { id: 103, name: "Konsultatsiya haqida", contact_name: null, phone: null, stage_id: 1, mizon_source: "manual", lead_score: 10 }
      ];
    }
    renderKanban(); // Render mock
  }
}

function getColumnColor(sequence) {
  const colors = ['#3B82F6', '#F59E0B', '#F97316', '#8B5CF6', '#EC4899', '#10B981'];
  return colors[(sequence - 1) % colors.length];
}

function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = ''; // Clear

  state.stages.forEach(stage => {
    // Filter leads for this stage
    const stageLeads = state.leads.filter(l => l.stage_id === stage.id);
    const color = getColumnColor(stage.sequence);

    // Create Column Frame
    const columnDiv = document.createElement('div');
    columnDiv.className = 'kanban-column';
    
    columnDiv.innerHTML = `
      <div class="column-header">
        <div class="column-title">
          <span style="width:12px;height:12px;border-radius:50%;background:${color}; display:inline-block;"></span>
          ${stage.name}
        </div>
        <span class="lead-count">${stageLeads.length}</span>
      </div>
      <div class="column-body" data-stage-id="${stage.id}">
      </div>
    `;

    const columnBody = columnDiv.querySelector('.column-body');

    // Add drag and drop event listeners to body
    columnBody.addEventListener('dragover', (e) => {
      e.preventDefault();
      columnBody.classList.add('drag-over');
    });

    columnBody.addEventListener('dragleave', () => {
      columnBody.classList.remove('drag-over');
    });

    columnBody.addEventListener('drop', (e) => {
      columnBody.classList.remove('drag-over');
      const leadId = e.dataTransfer.getData('text/plain');
      handleLeadDrop(leadId, stage.id);
    });

    // Create Cards
    stageLeads.forEach(lead => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.style.borderLeftColor = color;
      card.draggable = true;
      
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', lead.id);
      });

      card.innerHTML = `
        <div class="card-title">${escapeHTML(lead.name)}</div>
        <div class="card-details">
          ${lead.contact_name ? `<span>👤 ${escapeHTML(lead.contact_name)}</span>` : ''}
          ${lead.phone ? `<span>📞 ${escapeHTML(lead.phone)}</span>` : ''}
        </div>
        <div class="card-footer">
          <span class="badge badge-source">${formatSource(lead.mizon_source)}</span>
          <span class="badge badge-score">⭐ ${lead.lead_score}</span>
        </div>
      `;
      columnBody.appendChild(card);
    });

    board.appendChild(columnDiv);
  });
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function formatSource(src) {
  const map = {
    'manual': 'Manual',
    'phone_call': 'Qo\'ng\'iroq',
    'referral': 'Referral',
    'meta_fb_ads': 'Facebook Ads',
    'telegram_bot': 'Telegram'
  };
  return map[src] || src;
}

// Handle Drag Drop Update
async function handleLeadDrop(leadId, newStageId) {
  // Optimistic UI Update
  const lead = state.leads.find(l => l.id == leadId);
  if (lead && lead.stage_id !== newStageId) {
    const oldStageId = lead.stage_id;
    lead.stage_id = newStageId;
    renderKanban();

    // Call API to persist
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage_id: newStageId })
      });
      if (!res.ok) throw new Error('API not available');
    } catch (err) {
      console.warn('Backend ga yozolmadi, lekin demo uchun holat vaqtinchalik saqlanib qolindi.');
      // uncomment to rollback: fetchData();
    }
  }
}

// Add New Lead Form Submit
document.getElementById('leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const payload = {
    name: document.getElementById('leadName').value,
    contact_name: document.getElementById('leadContactName').value,
    phone: document.getElementById('leadPhone').value,
    source: document.getElementById('leadSource').value
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      document.getElementById('leadForm').reset();
      closeModal();
      fetchData(); // reload
    } else {
      throw new Error('API down');
    }
  } catch (err) {
    console.warn('Demo UI da darhol qoshildi, backendga uzatilmadi');
    
    // Mock save logic for demo
    const mockNewLead = {
      id: Math.floor(Math.random() * 1000) + 1000,
      name: payload.name,
      contact_name: payload.contact_name,
      phone: payload.phone,
      stage_id: 1, // Yangi lead stage
      mizon_source: payload.source,
      lead_score: 10 + (payload.phone ? 20 : 0)
    };
    state.leads.push(mockNewLead);
    
    document.getElementById('leadForm').reset();
    closeModal();
    renderKanban();
  }
});

// Initialize
fetchData();
