// Initialize Supabase client — must load after club-config.js
// All pages load this; use _supabase everywhere in page scripts.
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
