// Netlify function — fires after a pilot submits their post-flight report.
// Checks if another member has a reservation starting within 3 hours
// and that member has early_arrival_alert = true.
// Only sends if alert hasn't already been sent today (sent_alerts dedup).
// Requires: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE env vars

const ALLOWED_ORIGINS = [
    'https://n2134y.com',
    'https://www.n2134y.com',
    'http://localhost:8888',
    'http://localhost:3000'
];
const NETLIFY_PREVIEW_RE = /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/;
const EARLY_ARRIVAL_WINDOW_HRS = 3; // look-ahead window for next booking

function getCorsHeaders(event) {
    const origin  = event.headers?.origin || '';
    const allowed = (ALLOWED_ORIGINS.includes(origin) || NETLIFY_PREVIEW_RE.test(origin)) ? origin : '';
    return {
        'Access-Control-Allow-Origin':  allowed,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type':                 'application/json'
    };
}

async function verifyMember(event) {
    const jwt = (event.headers?.authorization || '').replace('Bearer ', '').trim();
    if (!jwt) return null;
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey    = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return null;
    try {
        const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function fmtTime(isoStr) {
    if (!isoStr) return '—';
    try {
        return new Date(isoStr).toLocaleString('en-US', {
            timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true
        });
    } catch { return isoStr; }
}

function fmtDateShort(isoStr) {
    if (!isoStr) return '—';
    try {
        return new Date(isoStr).toLocaleDateString('en-US', {
            timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric'
        });
    } catch { return isoStr; }
}

// Supabase service-role fetch helper
async function sbFetch(path, opts = {}) {
    const url     = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
    const headers = {
        'apikey':        process.env.SUPABASE_SERVICE_ROLE,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
        ...opts.headers
    };
    return fetch(url, { ...opts, headers });
}

export const handler = async (event) => {
    const cors = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
    if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    const user = await verifyMember(event);
    if (!user) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const siteUrl        = process.env.SITE_URL || 'https://n2134y.com';

    if (!RESEND_API_KEY) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'Email not configured' }) };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { airplaneId, pilotName, completedAt, reservationId } = body;

    if (!airplaneId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'airplaneId required' }) };

    const now       = new Date(completedAt || Date.now());
    const windowEnd = new Date(now.getTime() + EARLY_ARRIVAL_WINDOW_HRS * 60 * 60 * 1000);

    // ── Find next same-day reservation within window ──────────
    let nextRes = null;
    try {
        const resUrl = `reservations?airplane_id=eq.${encodeURIComponent(airplaneId)}&status=eq.confirmed&start_time=gt.${encodeURIComponent(now.toISOString())}&start_time=lte.${encodeURIComponent(windowEnd.toISOString())}&order=start_time.asc&limit=1&select=id,start_time,end_time,member_id,members(name,email)`;
        const resResp = await sbFetch(resUrl);
        if (resResp.ok) {
            const data = await resResp.json();
            nextRes = data?.[0] || null;
        }
    } catch (e) {
        console.warn('[notifyEarlyArrival] reservation lookup failed:', e?.message);
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'lookup error' }) };
    }

    if (!nextRes) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'no next reservation' }) };
    }

    const nextMemberId = nextRes.member_id;

    // Don't notify the same pilot (edge case: back-to-back own reservations)
    if (nextMemberId === user.id) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'same pilot' }) };
    }

    // ── Check dedup — has this alert already been sent? ───────
    try {
        const dedupUrl = `sent_alerts?alert_type=eq.early_arrival&reservation_id=eq.${encodeURIComponent(nextRes.id)}&recipient_id=eq.${encodeURIComponent(nextMemberId)}&limit=1&select=id`;
        const dedupRes = await sbFetch(dedupUrl);
        if (dedupRes.ok) {
            const existing = await dedupRes.json();
            if (existing?.length > 0) {
                return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'already sent' }) };
            }
        }
    } catch (e) { console.warn('[notifyEarlyArrival] dedup check failed:', e?.message); }

    // ── Check next pilot's notification preference ────────────
    try {
        const prefUrl = `notification_preferences?member_id=eq.${encodeURIComponent(nextMemberId)}&select=early_arrival_alert,schedule_impact_alert&limit=1`;
        const prefRes = await sbFetch(prefUrl);
        if (prefRes.ok) {
            const prefs = await prefRes.json();
            const pref  = prefs?.[0];
            // Must have both schedule_impact_alert AND early_arrival_alert enabled
            if (!pref || !pref.schedule_impact_alert || !pref.early_arrival_alert) {
                return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'not opted in' }) };
            }
        }
    } catch (e) { console.warn('[notifyEarlyArrival] prefs check failed:', e?.message); }

    const nextEmail = nextRes.members?.email;
    const nextName  = esc(nextRes.members?.name || 'Pilot');
    const pilotSafe = esc(pilotName || 'The previous pilot');

    if (!nextEmail) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'no email for next pilot' }) };
    }

    // ── Send early arrival email ──────────────────────────────
    const resDate  = fmtDateShort(nextRes.start_time);
    const resStart = fmtTime(nextRes.start_time);
    const resEnd   = fmtTime(nextRes.end_time);
    const doneAt   = fmtTime(completedAt || now.toISOString());

    try {
        const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from:    'Hi-Line Flying Club <onboarding@resend.dev>',
                to:      [nextEmail],
                subject: `✈️ Good news — N2134Y is available early`,
                html: `
                    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1E293B">
                        <h2 style="color:#E8A030;margin:0 0 12px">Plane Available Early</h2>
                        <p style="margin:0 0 12px">Hi ${nextName} — ${pilotSafe} just submitted their post-flight and the plane is back.</p>
                        <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:8px;padding:14px 18px;margin:0 0 16px">
                            <p style="margin:0;font-size:0.95em;color:#15803D">✅ N2134Y returned at <strong>${doneAt}</strong></p>
                        </div>
                        <p style="margin:0 0 8px;color:#475569">Your reservation: <strong>${resDate}, ${resStart} – ${resEnd}</strong></p>
                        <a href="${siteUrl}/schedule.html"
                           style="display:inline-block;margin-top:12px;background:#E8A030;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">
                            View Schedule →
                        </a>
                        <p style="color:#94a3b8;font-size:0.78em;margin-top:20px">
                            You're receiving this because you opted in to schedule impact alerts.<br>
                            To turn these off, update your <a href="${siteUrl}/dashboard.html" style="color:#94a3b8">notification preferences</a>.
                        </p>
                    </div>`
            })
        });

        // Record in sent_alerts to prevent duplicate
        if (emailRes.ok) {
            await sbFetch('sent_alerts', {
                method: 'POST',
                body: JSON.stringify({
                    alert_type:     'early_arrival',
                    reservation_id: nextRes.id,
                    recipient_id:   nextMemberId
                })
            });
        }
    } catch (e) { console.error('[notifyEarlyArrival] email failed:', e?.message); }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
};
