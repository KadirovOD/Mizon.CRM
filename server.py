#!/usr/bin/env python3
"""
Mizon CRM — Lokal Backend Server (Python fallback)
Frontendga API endpointlar beradi — Node.js o'rnatilmagan tizimlar uchun.
DB: SQLite (lokal), Production: PostgreSQL via Node.js / Vercel.

Ishga tushirish:  python3 server.py
"""

import json
import os
import sqlite3
import http.server
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

PORT = int(os.environ.get('PORT', 3000))
BASE_DIR = Path(__file__).parent
FRONTEND_DIR = BASE_DIR / 'frontend'
DB_PATH = BASE_DIR / 'mizon_crm.db'

# ========== SQLITE INIT ==========
def init_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.executescript('''
        CREATE TABLE IF NOT EXISTS crm_stage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sequence INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS crm_lead (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            contact_name TEXT,
            phone TEXT,
            email TEXT,
            stage_id INTEGER REFERENCES crm_stage(id),
            mizon_source TEXT DEFAULT 'manual',
            telegram_chat_id TEXT,
            lead_score INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            chatlogs TEXT DEFAULT '[]',
            deadline TEXT,
            actualcallattempts INTEGER DEFAULT 0,
            taskdescription TEXT,
            owner TEXT DEFAULT 'ceo',
            region TEXT,
            pipelineid TEXT DEFAULT 'p1'
        );
    ''')
    # Seed stages
    c.execute('SELECT COUNT(*) as cnt FROM crm_stage')
    if c.fetchone()['cnt'] == 0:
        c.executemany('INSERT INTO crm_stage (name, sequence) VALUES (?, ?)', [
            ('Yangi Lead', 1), ('Aloqaga chiqildi', 2), ('Ehtiyoj aniqlandi', 3),
            ('Taklif yuborildi', 4), ('Muzokaralar', 5), ('Yutildi', 6), ('Muvaffaqiyatsiz', 7)
        ])
    conn.commit()
    conn.close()
    print(f'✅ SQLite DB initialized: {DB_PATH}')

init_db()

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def row_to_dict(row):
    return dict(row) if row else None

# ========== REQUEST HANDLER ==========
class MizonHandler(http.server.SimpleHTTPRequestHandler):
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)
    
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, default=str).encode('utf-8'))

    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        return json.loads(body) if body else {}

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API Routes
        if path == '/api/health':
            self.send_json({'status': 'ok', 'dbConnected': True, 'version': 'V7-Python', 'timestamp': datetime.now(timezone.utc).isoformat()})

        elif path == '/api/leads':
            db = get_db()
            leads = [row_to_dict(r) for r in db.execute('SELECT l.*, s.name as stage_name FROM crm_lead l LEFT JOIN crm_stage s ON l.stage_id = s.id ORDER BY l.created_at DESC').fetchall()]
            stages = [row_to_dict(r) for r in db.execute('SELECT * FROM crm_stage ORDER BY sequence ASC').fetchall()]
            db.close()
            self.send_json({'success': True, 'leads': leads, 'stages': stages})

        elif path == '/api/stages':
            db = get_db()
            stages = [row_to_dict(r) for r in db.execute('SELECT * FROM crm_stage ORDER BY sequence ASC').fetchall()]
            db.close()
            self.send_json({'success': True, 'stages': stages})

        elif path == '/api/stats':
            db = get_db()
            total = db.execute('SELECT COUNT(*) as count FROM crm_lead').fetchone()['count']
            won = db.execute("SELECT COUNT(*) as count FROM crm_lead WHERE stage_id = (SELECT id FROM crm_stage WHERE name='Yutildi' LIMIT 1)").fetchone()['count']
            lost = db.execute("SELECT COUNT(*) as count FROM crm_lead WHERE stage_id = (SELECT id FROM crm_stage WHERE name='Muvaffaqiyatsiz' LIMIT 1)").fetchone()['count']
            overdue = db.execute("SELECT COUNT(*) as count FROM crm_lead WHERE deadline < datetime('now') AND deadline IS NOT NULL").fetchone()['count']
            active = db.execute("SELECT COUNT(*) as count FROM crm_lead WHERE taskdescription IS NOT NULL AND deadline > datetime('now')").fetchone()['count']
            sources = [row_to_dict(r) for r in db.execute('SELECT mizon_source, COUNT(*) as count FROM crm_lead GROUP BY mizon_source').fetchall()]
            db.close()
            self.send_json({'success': True, 'stats': {
                'totalLeads': total, 'wonDeals': won, 'lostDeals': lost,
                'overdueLeads': overdue, 'activeTasks': active, 'sourceBreakdown': sources
            }})

        elif path == '/api/webhook/meta':
            qs = urllib.parse.parse_qs(parsed.query)
            mode = qs.get('hub.mode', [None])[0]
            token = qs.get('hub.verify_token', [None])[0]
            challenge = qs.get('hub.challenge', [None])[0]
            if mode == 'subscribe' and token == os.environ.get('META_VERIFY_TOKEN', 'mizon_verification_token_123'):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(str(challenge).encode())
            else:
                self.send_response(403)
                self.end_headers()

        # Frontend files
        elif not path.startswith('/api'):
            if path == '/' or path == '':
                self.path = '/index.html'
            super().do_GET()
        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.read_body()

        if path == '/api/leads':
            name = body.get('name')
            if not name:
                return self.send_json({'error': 'Name is required'}, 400)
            phone = body.get('phone')
            email = body.get('email')
            source = body.get('source', 'manual')
            region = body.get('region', "Noma'lum")
            owner = body.get('owner', 'ceo')
            status = body.get('status', '1')
            pipeline_id = body.get('pipelineId', 'p1')
            score = 10 if source == 'manual' else 30
            if phone: score += 20

            db = get_db()
            try:
                stage_id = int(status) if status and str(status).isdigit() else 1
            except:
                stage_id = 1
            chatlogs = json.dumps([{'type':'sys', 'date': datetime.now(timezone.utc).isoformat(), 'text': f"Sistemaga qo'shildi ({source})"}])
            
            c = db.execute(
                '''INSERT INTO crm_lead (name, contact_name, phone, email, mizon_source, lead_score, stage_id, region, owner, pipelineid, chatlogs)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                [name, name, phone, email, source, score, stage_id, region, owner, pipeline_id, chatlogs]
            )
            db.commit()
            lead_id = c.lastrowid
            lead = row_to_dict(db.execute('SELECT * FROM crm_lead WHERE id = ?', [lead_id]).fetchone())
            db.close()
            print(f'📌 New Lead: {name} (source: {source})')
            self.send_json({'success': True, 'lead': lead}, 201)

        elif path == '/api/webhook/meta':
            if body.get('object') == 'page':
                for entry in body.get('entry', []):
                    for change in entry.get('changes', []):
                        if change.get('field') == 'leadgen':
                            ld = change['value']
                            db = get_db()
                            chatlogs = json.dumps([{'type':'sys', 'date': datetime.now(timezone.utc).isoformat(), 'text': f"Meta Lead Ads orqali keldi. Form: {ld.get('form_id')}"}])
                            db.execute(
                                'INSERT INTO crm_lead (name, contact_name, mizon_source, lead_score, stage_id, chatlogs) VALUES (?, ?, ?, ?, 1, ?)',
                                [f"Meta Lead: {ld.get('form_id','?')}", 'Facebook User', 'meta_fb_ads', 30, chatlogs]
                            )
                            db.commit()
                            db.close()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'EVENT_RECEIVED')
            else:
                self.send_json({'error': 'Not found'}, 404)

        elif path == '/api/webhook/telegram':
            message = body.get('message', {})
            if message:
                chat_id = str(message.get('chat', {}).get('id', ''))
                text = message.get('text', '')
                first_name = message.get('from', {}).get('first_name', 'User')
                if text == '/start' and chat_id:
                    db = get_db()
                    existing = db.execute('SELECT id FROM crm_lead WHERE telegram_chat_id = ?', [chat_id]).fetchone()
                    if not existing:
                        chatlogs = json.dumps([{'type':'sys', 'date': datetime.now(timezone.utc).isoformat(), 'text': f"Telegram orqali ro'yxatdan o'tdi"}])
                        db.execute(
                            'INSERT INTO crm_lead (name, contact_name, mizon_source, telegram_chat_id, lead_score, stage_id, chatlogs) VALUES (?, ?, ?, ?, ?, 1, ?)',
                            [first_name, first_name, 'telegram_bot', chat_id, 20, chatlogs]
                        )
                        db.commit()
                        print(f'📌 New Telegram Lead: {first_name} ({chat_id})')
                    db.close()
            self.send_response(200)
            self.end_headers()
        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.read_body()

        # PUT /api/leads/:id
        import re
        m = re.match(r'^/api/leads/(\d+)$', path)
        if m:
            lead_id = m.group(1)
            db = get_db()
            existing = db.execute('SELECT * FROM crm_lead WHERE id = ?', [lead_id]).fetchone()
            if not existing:
                db.close()
                return self.send_json({'error': 'Lead not found'}, 404)
            
            updates = []
            params = []
            for field, col in [('name','name'), ('phone','phone'), ('email','email'), ('region','region'), 
                               ('source','mizon_source'), ('owner','owner'), ('taskDescription','taskdescription')]:
                if field in body and body[field] is not None:
                    updates.append(f'{col} = ?')
                    params.append(body[field])
            
            if 'status' in body:
                try:
                    updates.append('stage_id = ?')
                    params.append(int(body['status']))
                except: pass
            if 'actualCallAttempts' in body:
                updates.append('actualcallattempts = ?')
                params.append(body['actualCallAttempts'])
            if 'deadline' in body:
                updates.append('deadline = ?')
                params.append(body.get('deadline'))
            if 'taskDescription' in body:
                updates.append('taskdescription = ?')
                params.append(body.get('taskDescription'))
            if 'chatLogs' in body:
                updates.append('chatlogs = ?')
                params.append(json.dumps(body['chatLogs']))
            
            if updates:
                params.append(lead_id)
                db.execute(f"UPDATE crm_lead SET {', '.join(updates)} WHERE id = ?", params)
                db.commit()
            
            lead = row_to_dict(db.execute('SELECT * FROM crm_lead WHERE id = ?', [lead_id]).fetchone())
            db.close()
            self.send_json({'success': True, 'lead': lead})
        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_DELETE(self):
        import re
        m = re.match(r'^/api/leads/(\d+)$', self.path)
        if m:
            lead_id = m.group(1)
            db = get_db()
            result = db.execute('DELETE FROM crm_lead WHERE id = ? RETURNING id', [lead_id])
            db.commit()
            db.close()
            self.send_json({'success': True, 'deletedId': lead_id})
        else:
            self.send_json({'error': 'Not found'}, 404)

    def log_message(self, format, *args):
        if '/api/' in str(args[0]) if args else False:
            super().log_message(format, *args)

if __name__ == '__main__':
    print(f'\n🚀 Mizon CRM Server running at http://localhost:{PORT}')
    print(f'📊 Dashboard: http://localhost:{PORT}')
    print(f'📡 API: http://localhost:{PORT}/api/health')
    print(f'🔗 Webhooks: /api/webhook/meta | /api/webhook/telegram\n')
    
    server = http.server.HTTPServer(('', PORT), MizonHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n⏹️  Server to\'xtatildi.')
        server.server_close()
