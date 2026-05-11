// Netlify function — notifies admin by email when a member cancels a reservation
// Requires RESEND_API_KEY and ADMIN_EMAIL environment variables in Netlify

const ALLOWED_ORIGINS = [
    'https://n2134y.com',
    'https://www.n2134y.com',
    'http://localhost:8888',
    'http://localhost:3000'
];
const NETLIFY_PREVIEW_RE = /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/;

function getCorsHeaders(event) {
    const origin = event.headers?.origin || '';
    const allowed = (ALLOWED_ORIGINS.includes(origin) || NETLIFY_PREVIEW_RE.test(origin)) ? origin : '';
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
}

async function verifyMember(event) {
    const jwt = (event.headers?.authorization || '').replace('Bearer ', '').trim();
    if (!jwt) return false;
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey    = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return false;
    try {
        const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey }
        });
        return res.ok;
    } catch { return false; }
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function fmtDateTime(isoStr) {
    if (!isoStr) return '—';
    try {
        return new Date(isoStr).toLocaleString('en-US', {
            timeZone: 'America/Chicago',
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    } catch { return isoStr; }
}

function fmtTime(isoStr) {
    if (!isoStr) return '—';
    try {
        return new Date(isoStr).toLocaleString('en-US', {
            timeZone: 'America/Chicago',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    } catch { return isoStr; }
}

export const handler = async (event) => {
    const cors = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
    if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    const authed = await verifyMember(event);
    if (!authed) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;

    // If email isn't configured, ack silently — cancellation already happened in DB
    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'Email not configured' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { memberName, startTime, endTime, tail } = body;

    if (!memberName || typeof memberName !== 'string' || memberName.length > 200) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'memberName invalid' }) };
    }
    if (!startTime || !endTime) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'startTime and endTime required' }) };
    }

    const safeName  = esc(memberName.trim());
    const safeTail  = esc((tail || 'N2134Y').trim().slice(0, 10));
    const startFmt  = fmtDateTime(startTime);
    const endFmt    = fmtTime(endTime);
    const siteUrl   = process.env.SITE_URL || 'https://n2134y.com';

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from:    'Hi-Line Flying Club <onboarding@resend.dev>',
            to:      [ADMIN_EMAIL],
            subject: `✈️ Reservation Cancelled — ${safeName}`,
            html:    `
                <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1E293B">
                    <h2 style="color:#E8A030;margin:0 0 16px">Reservation Cancelled</h2>
                    <p style="margin:0 0 8px">
                        <strong>${safeName}</strong> cancelled their reservation for <strong>${safeTail}</strong>:
                    </p>
                    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:14px 18px;margin:16px 0">
                        <p style="margin:0;font-size:1.05em">📅 ${startFmt} – ${endFmt}</p>
                    </div>
                    <p style="color:#64748B;font-size:0.9em">
                        The slot is now available for other members to book.
                    </p>
                    <a href="${siteUrl}/schedule.html"
                       style="display:inline-block;margin-top:8px;background:#E8A030;color:#fff;
                              padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700">
                        View Schedule →
                    </a>
                </div>`
        })
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: res.ok }) };
};
