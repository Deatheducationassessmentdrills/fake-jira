// ============================================================
// config.js — Supabase connection settings
// ============================================================
// Replace these two values with the ones from your Supabase project:
//   Settings → API → Project URL
//   Settings → API → anon/public key
//
// The anon key is safe to expose in frontend code as long as
// Row Level Security (RLS) is enabled on every table — which the
// schema SQL does by default.
// ============================================================

window.APP_CONFIG = {
  SUPABASE_URL:      'https://dbpmjnhuoqdnlkopiszg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_BpphhiiD4nFm4oqgo8cmsg_WhXDZ3Hs',

  // If true, falls back to localStorage when Supabase is unavailable.
  // Useful for offline testing. Set to false in production.
  ALLOW_LOCAL_FALLBACK: false
};
