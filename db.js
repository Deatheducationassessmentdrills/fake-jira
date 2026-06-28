// db.js — shared Supabase data layer; include after auth.js
(function () {
  function dbDate(s) { return (s && s.length) ? s : null; }

  function normalizeItem(i) {
    return {
      ...i,
      tags:       i.tags      || [],
      boards:     i.boards    || [],
      assignees:  i.assignees || [],
      notes:      i.notes     || '',
      reporter:   i.reporter  || '',
      start_date: i.start_date || '',
      end_date:   i.end_date   || '',
    };
  }

  window.DB = {
    async loadItems() {
      const { data, error } = await window._supabase
        .from('backlog_items').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizeItem);
    },

    async loadBoards() {
      const { data, error } = await window._supabase
        .from('backlog_boards').select('name').order('name');
      if (error) throw error;
      return (data || []).map(r => r.name);
    },

    async updateItem(id, patch) {
      const dbPatch = {};
      for (const [k, v] of Object.entries(patch)) {
        dbPatch[k] = (k === 'start_date' || k === 'end_date') ? dbDate(v) : v;
      }
      const { error } = await window._supabase
        .from('backlog_items').update(dbPatch).eq('id', id);
      return error;
    },

    async insertItem(item) {
      const { data, error } = await window._supabase
        .from('backlog_items')
        .insert({
          title:      item.title     || '',
          status:     item.status    || 'backlog',
          tags:       item.tags      || [],
          boards:     item.boards    || [],
          priority:   item.priority  || 'Medium',
          date:       item.date      || new Date().toISOString().split('T')[0],
          notes:      item.notes     || '',
          reporter:   item.reporter  || '',
          assignees:  item.assignees || [],
          start_date: dbDate(item.start_date),
          end_date:   dbDate(item.end_date),
        })
        .select('id')
        .single();
      if (error) return { id: null, error };
      return { id: data.id, error: null };
    },

    async deleteItem(id) {
      const { error } = await window._supabase
        .from('backlog_items').delete().eq('id', id);
      return error;
    },

    async migrateFromLocalStorage() {
      const localItems  = localStorage.getItem('backlog_items');
      const localBoards = localStorage.getItem('backlog_boards');
      if (!localItems) return false;
      try {
        const parsedItems  = JSON.parse(localItems);
        const parsedBoards = JSON.parse(localBoards || '[]');
        if (parsedBoards.length) {
          await window._supabase.from('backlog_boards')
            .upsert(parsedBoards.map(name => ({ name })), { onConflict: 'name' });
        }
        if (parsedItems.length) {
          const { error } = await window._supabase.from('backlog_items').insert(
            parsedItems.map(({ id: _id, ...i }) => ({
              title:      i.title     || '',
              status:     i.status    || 'backlog',
              tags:       i.tags      || [],
              boards:     i.boards    || [],
              priority:   i.priority  || 'Medium',
              date:       i.date      || new Date().toISOString().split('T')[0],
              notes:      i.notes     || '',
              reporter:   i.reporter  || '',
              assignees:  i.assignees || [],
              start_date: dbDate(i.start_date),
              end_date:   dbDate(i.end_date),
            }))
          );
          if (error) return false;
        }
        localStorage.removeItem('backlog_items');
        localStorage.removeItem('backlog_boards');
        localStorage.removeItem('backlog_nextId');
        return true;
      } catch (e) { return false; }
    },

    normalizeItem,
    dbDate,
  };
})();
