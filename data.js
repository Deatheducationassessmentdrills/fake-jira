/* ============================================================
   data.js — Shared data layer for index.html and backlog.html

   Contents:
     1. Constants (statuses, tags, due ranges, etc.)
     2. Pure helpers (escHtml, renderMarkdown, avatarColor, etc.)
     3. Schema normalizer
     4. Storage adapter interface + LocalStorageAdapter
     5. SupabaseAdapter stub (swap point for migration day)
     6. Mutation helper (mutateItem)
     7. Recurring-item logic
     8. CSV/JSON serialization

   Both pages <script src="data.js"> this file BEFORE their own
   inline <script>. All exports live on `window.DataLayer` to
   avoid polluting the global namespace.

   When Supabase is approved, the only line that needs to change
   is in init: swap `new LocalStorageAdapter()` for
   `new SupabaseAdapter()`.
   ============================================================ */
(function (global) {
  'use strict';

  // ── 1. CONSTANTS ────────────────────────────────────────────
  const STORAGE_KEYS = {
    items:    'backlog_items',
    boards:   'backlog_boards',
    team:     'backlog_team',
    nextId:   'backlog_nextId',
    user:     'current_user',
    presets:  'filter_presets'
  };

  const STATUSES      = ['ideas','backlog','progress','blocked','done'];
  const STATUS_LABELS = { ideas:'Ideas', backlog:'Backlog', progress:'In Progress', blocked:'Blocked', done:'Done' };
  const ALL_TAGS      = ['Feature','Bug','Setup','Design','Research','Idea','Content'];
  const PRIORITIES    = ['High','Medium','Low'];
  const RECUR_DAYS    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const AVATAR_COLORS = ['#3a8fff','#7b61ff','#f5a623','#3ecf8e','#ff4d6d','#ff9de2','#a0a0b8'];

  const DUE_RANGES = [
    { id: 'all',     label: 'All' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'week',    label: 'This Week' },
    { id: 'month',   label: 'This Month' },
    { id: 'none',    label: 'No Due Date' }
  ];

  // ── 2. PURE HELPERS ────────────────────────────────────────
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
  }

  function initials(name) {
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function assigneeBadgesHTML(assignees) {
    if (!assignees || !assignees.length) return '';
    return `<div class="assignee-badges">${assignees.slice(0,3).map(a =>
      `<div class="assignee-badge" style="background:${avatarColor(a)}" title="${escHtml(a)}">${initials(a)}</div>`
    ).join('')}${assignees.length > 3
      ? `<div class="assignee-badge" style="background:var(--muted)" title="${escHtml(assignees.slice(3).join(', '))}">+${assignees.length-3}</div>`
      : ''}</div>`;
  }

  function dueBadgeHTML(due) {
    if (!due) return '';
    const d = new Date(due);
    const now = new Date();
    const diff = (d - now) / 86400000;
    const label = d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    if (diff < 0)  return `<span class="due-badge due-overdue" title="Overdue">⚠ ${label}</span>`;
    if (diff < 7)  return `<span class="due-badge due-soon" title="Due soon">${label}</span>`;
    return `<span class="due-badge due-ok">${label}</span>`;
  }

  function suffix(n) {
    const s = ['th','st','nd','rd']; const v = n % 100;
    return s[(v-20)%10] || s[v] || s[0];
  }

  // Tiny markdown renderer — escapes first, then transforms in safe order
  function renderMarkdown(src) {
    if (!src) return '';
    let s = escHtml(src);
    s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    s = s.replace(/^---+$/gm, '<hr>');
    s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^\*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^\*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/(^(?:- .+\n?)+)/gm, m =>
      '<ul>' + m.trim().split('\n').map(line => `<li>${line.replace(/^- /, '')}</li>`).join('') + '</ul>');
    s = s.replace(/(^(?:\d+\. .+\n?)+)/gm, m =>
      '<ol>' + m.trim().split('\n').map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`).join('') + '</ol>');
    const blocks = s.split(/\n{2,}/);
    s = blocks.map(b => {
      b = b.trim();
      if (!b) return '';
      if (/^<(h\d|ul|ol|pre|blockquote|hr)/.test(b)) return b;
      return `<p>${b.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');
    return s;
  }

  // ── 3. CSV HELPERS ─────────────────────────────────────────
  function csvEscape(val) {
    if (val == null) return '';
    const s = String(val);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function itemsToCSV(items) {
    const live = items.filter(i => !i.deleted_at);
    const headers = ['id','title','status','priority','tags','boards','assignees',
      'due','estimate','archived','date','created_at','created_by','updated_at','notes'];
    const rows = [headers.join(',')];
    for (const item of live) {
      rows.push([
        item.id,
        csvEscape(item.title),
        item.status,
        item.priority || 'Medium',
        csvEscape((item.tags||[]).join('; ')),
        csvEscape((item.boards||[]).join('; ')),
        csvEscape((item.assignees||[]).join('; ')),
        item.due || '',
        item.estimate || '',
        item.archived ? 'true' : 'false',
        item.date || '',
        item.created_at || '',
        csvEscape(item.created_by || ''),
        item.updated_at || '',
        csvEscape(item.notes || '')
      ].join(','));
    }
    return rows.join('\n');
  }

  // RFC 4180 CSV parser — handles quoted fields, escaped quotes, multiline cells
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false, i = 0;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i+1] === '"') { field += '"'; i += 2; continue; }
        if (ch === '"') { inQuotes = false; i++; continue; }
        field += ch; i++;
      } else {
        if (ch === '"') { inQuotes = true; i++; continue; }
        if (ch === ',') { row.push(field); field = ''; i++; continue; }
        if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
        field += ch; i++;
      }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim()));
  }

  // ── 4. SCHEMA NORMALIZER ───────────────────────────────────
  // Backfills missing fields on items so both the kanban (single tag) and
  // backlog (tags array) can read each other's writes safely.
  function normalizeItem(item) {
    if (!item.tags) item.tags = item.tag ? [item.tag] : [];
    if (!item.tag)  item.tag  = item.tags[0] || '';
    if (!item.notes)    item.notes    = '';
    if (!item.desc)     item.desc     = '';
    if (!item.boards)   item.boards   = [];
    if (!item.priority) item.priority = 'Medium';
    if (!item.assignees) item.assignees = [];
    if (!item.due)      item.due      = '';
    if (!item.estimate) item.estimate = '';
    if (item.archived === undefined) item.archived = false;
    if (!item.created_at) item.created_at = item.date ? item.date + 'T00:00:00.000Z' : new Date().toISOString();
    if (!item.created_by) item.created_by = 'Legacy';
    if (!item.updated_at) item.updated_at = item.created_at;
    if (item.deleted_at === undefined) item.deleted_at = null;
    if (item.recurring === undefined) item.recurring = null;
    if (item.last_recurred_at === undefined) item.last_recurred_at = null;
    if (!item.subtasks) item.subtasks = [];
    if (!item.comments) item.comments = [];
    return item;
  }

  // ── 5. CURRENT USER ────────────────────────────────────────
  // Cached user email. When Supabase Auth fires onAuthStateChange,
  // pages call DataLayer.setCurrentUser() to update this.
  let _cachedUser = localStorage.getItem(STORAGE_KEYS.user) || 'Anonymous';

  function currentUser() {
    return _cachedUser;
  }

  function setCurrentUser(user) {
    _cachedUser = user || 'Anonymous';
  }

  // ── 6. STORAGE ADAPTERS ────────────────────────────────────
  // Both files instantiate ONE of these in init. Identical interface.
  //
  // Interface:
  //   loadAll()          → Promise<{ items, boards, team, nextId }>
  //   saveItem(item)     → Promise<savedItem>   (upsert one item)
  //   deleteItem(id)     → Promise<void>        (hard delete by id)
  //   saveBoards(arr)    → Promise<void>        (replace boards list)
  //   saveTeam(arr)      → Promise<void>        (replace team list)
  //   savePresets(presets) → Promise<void>      (replace user's presets)
  //   loadPresets()      → Promise<presets[]>
  //   subscribe(cb)      → unsubscribe fn       (cb called on remote change)
  //
  // All HTML files call these via the wrappers in data layer; no direct
  // localStorage / supabase calls anywhere else.

  class LocalStorageAdapter {
    constructor() {
      this._listeners = [];
      window.addEventListener('storage', e => {
        if ([STORAGE_KEYS.items, STORAGE_KEYS.boards, STORAGE_KEYS.team].includes(e.key)) {
          this._listeners.forEach(cb => cb({ source: 'localStorage' }));
        }
      });
    }

    async loadAll() {
      const out = { items: [], boards: [], team: [], nextId: 100 };
      try {
        const savedItems  = localStorage.getItem(STORAGE_KEYS.items);
        const savedBoards = localStorage.getItem(STORAGE_KEYS.boards);
        const savedTeam   = localStorage.getItem(STORAGE_KEYS.team);
        const savedNextId = localStorage.getItem(STORAGE_KEYS.nextId);
        if (savedItems)  out.items  = JSON.parse(savedItems).map(normalizeItem);
        if (savedBoards) out.boards = JSON.parse(savedBoards);
        if (savedTeam)   out.team   = JSON.parse(savedTeam);
        if (savedNextId) out.nextId = parseInt(savedNextId);
      } catch (e) {
        console.warn('Storage load failed', e);
      }
      return out;
    }

    // Bulk save — used by old wrappers, kept for back-compat.
    // Pass { items, boards, team, nextId } — saves whatever's defined.
    async save(state) {
      try {
        if (state.items  !== undefined) localStorage.setItem(STORAGE_KEYS.items,  JSON.stringify(state.items));
        if (state.boards !== undefined) localStorage.setItem(STORAGE_KEYS.boards, JSON.stringify(state.boards));
        if (state.team   !== undefined) localStorage.setItem(STORAGE_KEYS.team,   JSON.stringify(state.team));
        if (state.nextId !== undefined) localStorage.setItem(STORAGE_KEYS.nextId, state.nextId);
      } catch (e) { console.warn('Storage save failed', e); }
    }

    // Per-item save — for LocalStorage we just bulk-save the whole array
    // since it's cheap and the page already has the full list in memory.
    async saveItem(item, allItems) {
      try {
        localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(allItems));
      } catch (e) { console.warn('Storage saveItem failed', e); }
      return item;
    }

    async deleteItem(id, allItems) {
      try {
        const filtered = allItems.filter(i => i.id !== id);
        localStorage.setItem(STORAGE_KEYS.items, JSON.stringify(filtered));
      } catch (e) { console.warn('Storage deleteItem failed', e); }
    }

    async saveBoards(arr) {
      try { localStorage.setItem(STORAGE_KEYS.boards, JSON.stringify(arr)); }
      catch (e) { console.warn('Storage saveBoards failed', e); }
    }

    async saveTeam(arr) {
      try { localStorage.setItem(STORAGE_KEYS.team, JSON.stringify(arr)); }
      catch (e) { console.warn('Storage saveTeam failed', e); }
    }

    async loadPresets() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.presets) || '[]'); }
      catch (e) { return []; }
    }

    async savePresets(presets) {
      try { localStorage.setItem(STORAGE_KEYS.presets, JSON.stringify(presets)); }
      catch (e) { console.warn('Storage savePresets failed', e); }
    }

    subscribe(cb) {
      this._listeners.push(cb);
      return () => { this._listeners = this._listeners.filter(l => l !== cb); };
    }
  }

  /**
   * SupabaseAdapter — full implementation for the live Postgres backend.
   *
   * Pass a Supabase client created via:
   *   const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
   *   const storage = new DataLayer.SupabaseAdapter(sb)
   *
   * All methods are async. Realtime subscription forwards remote changes
   * to subscribers via the same callback signature as LocalStorageAdapter.
   */
  class SupabaseAdapter {
    constructor(client) {
      if (!client) throw new Error('SupabaseAdapter requires a Supabase client');
      this.client = client;
      this._listeners = [];
      this._channel = null;
      this._setupRealtime();
    }

    _setupRealtime() {
      this._channel = this.client
        .channel('items-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'items' },
            payload => this._listeners.forEach(cb => cb({ source: 'supabase', table: 'items', payload })))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' },
            payload => this._listeners.forEach(cb => cb({ source: 'supabase', table: 'boards', payload })))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' },
            payload => this._listeners.forEach(cb => cb({ source: 'supabase', table: 'team_members', payload })))
        .subscribe();
    }

    // Map a JS item to a DB row. Drops legacy 'id' if 0/undefined for inserts.
    _itemToRow(item) {
      const row = {
        title: item.title || '',
        status: item.status || 'backlog',
        tags: item.tags || [],
        tag: item.tag || null,
        boards: item.boards || [],
        assignees: item.assignees || [],
        priority: item.priority || 'Medium',
        due: item.due || null,
        estimate: item.estimate || null,
        notes: item.notes || '',
        description: item.desc || '',
        archived: !!item.archived,
        date: item.date || null,
        recurring: item.recurring || null,
        last_recurred_at: item.last_recurred_at || null,
        subtasks: item.subtasks || [],
        comments: item.comments || [],
        created_at: item.created_at || new Date().toISOString(),
        created_by: item.created_by || 'Anonymous',
        deleted_at: item.deleted_at || null
      };
      if (item.id && item.id > 0) row.id = item.id;
      return row;
    }

    _rowToItem(row) {
      return normalizeItem({
        id: row.id,
        title: row.title,
        status: row.status,
        tags: row.tags || [],
        tag: row.tag || (row.tags && row.tags[0]) || '',
        boards: row.boards || [],
        assignees: row.assignees || [],
        priority: row.priority,
        due: row.due || '',
        estimate: row.estimate || '',
        notes: row.notes || '',
        desc: row.description || '',
        archived: row.archived,
        date: row.date || '',
        recurring: row.recurring || null,
        last_recurred_at: row.last_recurred_at || null,
        subtasks: row.subtasks || [],
        comments: row.comments || [],
        created_at: row.created_at,
        created_by: row.created_by,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at || null
      });
    }

    async loadAll() {
      const [itemsRes, boardsRes, teamRes] = await Promise.all([
        this.client.from('items').select('*').order('created_at', { ascending: false }),
        this.client.from('boards').select('name'),
        this.client.from('team_members').select('name')
      ]);
      if (itemsRes.error)  console.error('Load items failed:',  itemsRes.error);
      if (boardsRes.error) console.error('Load boards failed:', boardsRes.error);
      if (teamRes.error)   console.error('Load team failed:',   teamRes.error);

      return {
        items:  (itemsRes.data || []).map(r => this._rowToItem(r)),
        boards: (boardsRes.data || []).map(b => b.name),
        team:   (teamRes.data || []).map(t => t.name),
        nextId: 0  // Postgres assigns IDs — nextId is unused
      };
    }

    // Bulk save — used only for one-time migration from localStorage
    async save(state) {
      if (state.items?.length) {
        // Strip ids so Postgres assigns fresh ones; this is a migration only
        const rows = state.items.map(i => {
          const r = this._itemToRow(i);
          delete r.id;
          return r;
        });
        const { error } = await this.client.from('items').insert(rows);
        if (error) console.error('Migration save failed:', error);
      }
      if (state.boards?.length) {
        await this.client.from('boards')
          .upsert(state.boards.map(name => ({ name })), { onConflict: 'name' });
      }
      if (state.team?.length) {
        await this.client.from('team_members')
          .upsert(state.team.map(name => ({ name })), { onConflict: 'name' });
      }
    }

    async saveItem(item, _allItems) {
      const row = this._itemToRow(item);
      if (row.id) {
        // Update existing
        const { data, error } = await this.client.from('items')
          .update(row).eq('id', row.id).select().single();
        if (error) { console.error('saveItem update failed:', error); throw error; }
        return this._rowToItem(data);
      } else {
        // Insert new
        const { data, error } = await this.client.from('items')
          .insert(row).select().single();
        if (error) { console.error('saveItem insert failed:', error); throw error; }
        return this._rowToItem(data);
      }
    }

    async deleteItem(id) {
      const { error } = await this.client.from('items').delete().eq('id', id);
      if (error) { console.error('deleteItem failed:', error); throw error; }
    }

    async saveBoards(arr) {
      // Replace strategy: get current names, insert any missing, delete any removed
      const { data: existing } = await this.client.from('boards').select('name');
      const existingNames = (existing || []).map(b => b.name);
      const toAdd = arr.filter(n => !existingNames.includes(n));
      const toRemove = existingNames.filter(n => !arr.includes(n));
      if (toAdd.length)    await this.client.from('boards').insert(toAdd.map(name => ({ name })));
      if (toRemove.length) await this.client.from('boards').delete().in('name', toRemove);
    }

    async saveTeam(arr) {
      const { data: existing } = await this.client.from('team_members').select('name');
      const existingNames = (existing || []).map(t => t.name);
      const toAdd = arr.filter(n => !existingNames.includes(n));
      if (toAdd.length) await this.client.from('team_members').insert(toAdd.map(name => ({ name })));
      // Don't auto-delete team members — they may be referenced by historical items
    }

    async loadPresets() {
      const { data: { user } } = await this.client.auth.getUser();
      if (!user?.email) return [];
      const { data, error } = await this.client.from('filter_presets')
        .select('name, state').eq('user_email', user.email);
      if (error) { console.error('loadPresets failed:', error); return []; }
      return (data || []).map(p => ({ name: p.name, state: p.state }));
    }

    async savePresets(presets) {
      const { data: { user } } = await this.client.auth.getUser();
      if (!user?.email) return;
      // Replace strategy: delete all, insert all (presets list is small)
      await this.client.from('filter_presets').delete().eq('user_email', user.email);
      if (presets.length) {
        const rows = presets.map(p => ({ user_email: user.email, name: p.name, state: p.state }));
        await this.client.from('filter_presets').insert(rows);
      }
    }

    subscribe(cb) {
      this._listeners.push(cb);
      return () => { this._listeners = this._listeners.filter(l => l !== cb); };
    }
  }

  // ── 7. RECURRING ITEMS ─────────────────────────────────────
  function shouldRecurToday(item) {
    if (!item.recurring || !item.recurring.pattern) return false;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    if (item.last_recurred_at === today) return false;
    const r = item.recurring;
    if (r.pattern === 'daily') return true;
    if (r.pattern === 'weekly') return RECUR_DAYS[now.getDay()] === r.day;
    if (r.pattern === 'monthly') return now.getDate() === parseInt(r.date || 1);
    return false;
  }

  function spawnRecurrence(template, getNextId) {
    const now = new Date().toISOString();
    const today = now.split('T')[0];
    const newItem = normalizeItem({
      id: getNextId(),
      title: template.title,
      status: 'backlog',
      tags: [...(template.tags||[])],
      tag: template.tags?.[0] || template.tag || '',
      boards: [...(template.boards||[])],
      assignees: [...(template.assignees||[])],
      priority: template.priority || 'Medium',
      due: '',
      estimate: template.estimate || '',
      archived: false,
      deleted_at: null,
      notes: template.notes || '',
      desc: template.desc || '',
      date: today,
      created_at: now,
      created_by: 'Recurring',
      updated_at: now,
      recurring: null,
      last_recurred_at: null
    });
    template.last_recurred_at = today;
    template.updated_at = now;
    return newItem;
  }

  function describeRecurrence(r) {
    if (!r || !r.pattern) return 'Not recurring';
    if (r.pattern === 'daily')   return 'Every day';
    if (r.pattern === 'weekly')  return `Every ${r.day || 'Mon'}`;
    if (r.pattern === 'monthly') return `Every month on the ${r.date || 1}${suffix(r.date || 1)}`;
    return 'Custom';
  }

  // ── 8. EXPORT ──────────────────────────────────────────────
  global.DataLayer = {
    // Constants
    STATUSES, STATUS_LABELS, ALL_TAGS, PRIORITIES, RECUR_DAYS,
    AVATAR_COLORS, DUE_RANGES, STORAGE_KEYS,

    // Helpers
    escHtml, renderMarkdown,
    avatarColor, initials, assigneeBadgesHTML, dueBadgeHTML,
    suffix,

    // Schema
    normalizeItem, currentUser, setCurrentUser,

    // Storage
    LocalStorageAdapter, SupabaseAdapter,

    // CSV
    csvEscape, itemsToCSV, parseCSV,

    // Recurring
    shouldRecurToday, spawnRecurrence, describeRecurrence
  };

})(window);
