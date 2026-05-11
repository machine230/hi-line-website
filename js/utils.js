// ─────────────────────────────────────────────────────────────
//  Shared utilities — load before auth.js and page scripts
// ─────────────────────────────────────────────────────────────

// Security: escape all DB-sourced strings before DOM insertion
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#x27;');
}

// ── Date / time ──────────────────────────────────────────────
// All display uses CLUB.timezone (defined in club-config.js, loaded first).
// Server-side ISO strings are UTC; timeZone converts them to club local time.

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US',
    { timeZone: CLUB.timezone, month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-US',
    { timeZone: CLUB.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtTime(d) {
  return (d instanceof Date ? d : new Date(d))
    .toLocaleString('en-US', { timeZone: CLUB.timezone, hour: 'numeric', minute: '2-digit', hour12: true });
}

// fmtHour renders a calendar grid label (0–23 → "8 AM").
// Pure arithmetic — no Date object needed, no timezone risk.
function fmtHour(h) {
  const suffix = h < 12 ? 'AM' : 'PM';
  const hr = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hr} ${suffix}`;
}

function fmtHobbs(val) {
  return val != null ? Number(val).toFixed(1) : '—';
}

// Convert datetime-local input value → ISO string (or null)
function localToISO(val) {
  return val ? new Date(val).toISOString() : null;
}

// Convert ISO string → datetime-local input value (YYYY-MM-DDTHH:MM)
function isoToLocal(iso) {
  return iso ? iso.slice(0, 16) : '';
}

// ── Misc ─────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
