// Netlify function — fires when a member cancels a reservation.
// 1. Emails admin only if club_settings.admin_cancellation_notify = true
// 2. Blasts opted-in members if slot is within blast_window_hours
// Requires: RESEND_API_KEY, ADMIN_EMAIL, SUPABASE_URL, SUPABASE_SERVICE_ROLE env vars

const ALLOWED_ORIGINS = [
    'https://n2134y.com',
    'https://www.n2134y.com',
    'http://localhost:8888',
    'http://localhost:3000'
];
const NETLIFY_PREVIEW_RE = /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/;

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

// Returns the verified user ID from the JWT, or null if invalid/missing.
// Never trust the client-supplied member ID — always verify via Supabase.
async function verifyMember(event) {
    const jwt        = (event.headers?.authorization || '').replace('Bearer ', '').trim();
    if (!jwt) return null;
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey    = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return null;
    try {
        const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.id || null;
    } catch { return null; }
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function fmtDateTime(isoStr) {
    if (!isoStr) return '—';
    try {
        return new Date(isoStr).toLocaleString('en-US', {
            timeZone: 'America/Los_Angeles',
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    } catch { return isoStr; }
}

function fmtTime(isoStr) {
    if (!isoStr) return '—';
    try {
        return new Date(isoStr).toLocaleString('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: 'numeric', minute: '2-digit', hour12: true
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
        ...opts.headers
    };
    return fetch(url, { ...opts, headers });
}

export const handler = async (event) => {
    const cors = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
    if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    // Verify JWT and extract the caller's user ID server-side — never trust client-supplied IDs.
    const callerUserId = await verifyMember(event);
    if (!callerUserId) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
    const siteUrl        = process.env.SITE_URL || 'https://n2134y.com';

    if (!RESEND_API_KEY) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'Email not configured' }) };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    // cancellingMemberId from body is IGNORED — we use the JWT-verified callerUserId instead.
    const { memberName, startTime, endTime, tail, airplaneId } = body;

    if (!memberName || typeof memberName !== 'string' || memberName.length > 200)
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'memberName invalid' }) };
    if (!startTime || !endTime)
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'startTime and endTime required' }) };

    const safeName  = esc(memberName.trim());
    const safeTail  = esc((tail || 'N2134Y').trim().slice(0, 10));
    const startFmt  = fmtDateTime(startTime);
    const endFmt    = fmtTime(endTime);

    // ── 1. Fetch club settings ─────────────────────────────────
    let adminCancelNotify = false;
    let blastWindowHours  = 48;

    if (airplaneId) {
        try {
            const settingsRes = await sbFetch(
                `club_settings?airplane_id=eq.${encodeURIComponent(airplaneId)}&select=admin_cancellation_notify,blast_window_hours&limit=1`
            );
            if (settingsRes.ok) {
                const settings = await settingsRes.json();
                if (settings?.[0]) {
                    adminCancelNotify = settings[0].admin_cancellation_notify === true;
                    blastWindowHours  = settings[0].blast_window_hours ?? 48;
                }
            }
        } catch (e) { console.warn('[cancelReservation] club_settings fetch failed:', e?.message); }
    }

    const emails = [];

    // ── 2. Admin notification (opt-in only) ───────────────────
    if (adminCancelNotify && ADMIN_EMAIL) {
        emails.push(
            fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from:    'Hi-Line Flying Club <onboarding@resend.dev>',
                    to:      [ADMIN_EMAIL],
                    subject: `✈️ Reservation Cancelled — ${safeName}`,
                    html: `
                        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1E293B">
                            <h2 style="color:#E8A030;margin:0 0 16px">Reservation Cancelled</h2>
                            <p style="margin:0 0 8px"><strong>${safeName}</strong> cancelled their reservation for <strong>${safeTail}</strong>:</p>
                            <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px 18px;margin:16px 0">
                                <p style="margin:0;font-size:1.05em">📅 ${startFmt} – ${endFmt}</p>
                            </div>
                            <p style="color:#64748B;font-size:0.9em">The slot is now available for other members to book.</p>
                            <a href="${siteUrl}/schedule.html"
                               style="display:inline-block;margin-top:8px;background:#E8A030;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">
                                View Schedule →
                            </a>
                        </div>`
                })
            }).catch(e => console.error('[cancelReservation] admin email failed:', e?.message))
        );
    }

    // ── 3. Cancellation blast to opted-in members ─────────────
    // Only blast if the freed slot starts within blast_window_hours from now
    const slotStart  = new Date(startTime);
    const windowEnd  = new Date(Date.now() + blastWindowHours * 60 * 60 * 1000);
    const withinWindow = slotStart > new Date() && slotStart <= windowEnd;

    if (withinWindow) {
        try {
            // Fetch all opted-in active members (exclude the cancelling pilot)
            let prefsUrl = `notification_preferences?cancellation_blast=eq.true&select=member_id,members(email,name)`;
            const prefsRes = await sbFetch(prefsUrl);
            if (prefsRes.ok) {
                const prefs = await prefsRes.json();
                const blastDate = new Date(startTime).toLocaleDateString('en-US', {
                    timeZone: 'America/Los_Angeles', weekday:'short', month:'short', day:'numeric'
                });
                const blastStart = fmtTime(startTime);
                const blastEnd   = fmtTime(endTime);

                for (const pref of (prefs || [])) {
                    // Skip the member who just cancelled (using JWT-verified server-side ID)
                    if (pref.member_id === callerUserId) continue;
                    const memberEmail = pref.members?.email;
                    const memberName  = esc(pref.members?.name || 'Pilot');
                    if (!memberEmail) continue;

                    emails.push(
                        fetch('https://api.resend.com/emails', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                from:    'Hi-Line Flying Club <onboarding@resend.dev>',
                                to:      [memberEmail],
                                subject: `✈️ Slot open: ${safeTail} ${blastDate} ${blastStart}–${blastEnd}`,
                                html: `
                                    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1E293B">
                                        <h2 style="color:#E8A030;margin:0 0 12px">Slot Just Opened</h2>
                                        <p style="margin:0 0 8px">Hi ${memberName} — a reservation was just cancelled and <strong>${safeTail}</strong> is now available:</p>
                                        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px 18px;margin:16px 0">
                                            <p style="margin:0;font-size:1.1em;font-weight:700">📅 ${blastDate}</p>
                                            <p style="margin:4px 0 0;font-size:1.05em">🕐 ${blastStart} – ${blastEnd}</p>
                                        </div>
                                        <a href="${siteUrl}/schedule.html"
                                           style="display:inline-block;background:#E8A030;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1em">
                                            Book it now →
                                        </a>
                                        <p style="color:#94a3b8;font-size:0.78em;margin-top:20px">
                                            You're receiving this because you opted in to slot alerts.<br>
                                            To turn these off, visit your <a href="${siteUrl}/dashboard.html" style="color:#94a3b8">notification preferences</a>.
                                        </p>
                                    </div>`
                            })
                        }).catch(e => console.error('[cancelReservation] blast email failed:', e?.message))
                    );
                }
            }
        } catch (e) { console.warn('[cancelReservation] blast fetch failed:', e?.message); }
    }

    // Fire all emails concurrently
    await Promise.allSettled(emails);

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
};
