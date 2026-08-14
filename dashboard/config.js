/* ============================================================
   Whatcha Dashboard — runtime config
   LIVE mode: real login + your data synced across devices via Supabase.
   The publishable key below is safe to ship in the browser — your data
   is protected by Row-Level Security (see supabase-schema.sql), not by
   hiding this key.
   To go back to local demo mode, set backend: "local".
   ============================================================ */
window.WHATCHA_CONFIG = {
  backend: "supabase", // "supabase" (live) or "local" (browser-only demo)
  supabaseUrl: "https://ivvoyzehxpdqtqmfsoxb.supabase.co",
  supabaseAnonKey: "sb_publishable_-_LLFYYSC5ctBmDL27gtdQ_P9343TDy",
};
