// ─────────────────────────────────────────────────────────────
//  Club Configuration — edit this file for each new deployment
// ─────────────────────────────────────────────────────────────

const CLUB = {
  name:    'Hi-Line Flying Club',
  short:   'N213',              // nav logo text (before the span)
  span:    '4Y',               // nav logo span text (accent color)
  airport: 'KRNT',             // home airport ICAO — used for weather
  aircraft: [
    { tail: 'N2134Y', type: 'Cessna 172D', year: 1963, rate: null } // TODO: set hourly rate
  ]
};

// Supabase — Supabase → Settings → API
// TODO: fill in after creating the Hi-Line Supabase project
const SUPABASE_URL  = 'https://NEWPROJECT.supabase.co';
const SUPABASE_ANON = 'sb_publishable_XXXX';

// Convenience shim — primary aircraft tail (used in queries throughout the app)
const AIRPLANE_TAIL = CLUB.aircraft[0].tail;
