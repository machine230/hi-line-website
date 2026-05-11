// ─────────────────────────────────────────────────────────────
//  Club Configuration — edit this file for each new deployment
// ─────────────────────────────────────────────────────────────

const CLUB = {
  name:     'Hi-Line Flying Club',
  short:    'N213',              // nav logo text (before the span)
  span:     '4Y',               // nav logo span text (accent color)
  airport:  'KRNT',             // home airport ICAO — used for weather
  timezone: 'America/Los_Angeles', // IANA timezone — all date display uses this
  aircraft: [
    {
      tail:           'N2134Y',
      type:           'Cessna 172D',
      year:           1963,
      rate:           null,        // TODO: set hourly rate
      fuel_cap_gal:   26,          // 2 × 13-gal tanks
      oil_cap_qt:      8,          // Lycoming O-320 sump capacity
      max_flight_hrs:  6.0         // sanity ceiling for single-flight tach delta
    }
  ]
};

// Supabase — Supabase → Settings → API
const SUPABASE_URL  = 'https://igaiscktzmhoeqtvhbdu.supabase.co';
const SUPABASE_ANON = 'sb_publishable_n30XuhMLcbWM2eVODLNx5A_pi8jYmL4';

// Convenience shim — primary aircraft tail (used in queries throughout the app)
const AIRPLANE_TAIL = CLUB.aircraft[0].tail;
