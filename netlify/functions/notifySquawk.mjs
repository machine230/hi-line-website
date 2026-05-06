// Netlify function — sends email to admin when a squawk is reported
// Requires RESEND_API_KEY and ADMIN_EMAIL environment variables in Netlify

const ALLOWED_ORIGINS = [
    'https://n2134y.com',
    'https://www.n2134y.com',
    'http://localhost:8888',
    'http://localhost:3000'
];

function getCorsHeaders(event) {
    const origin = event.headers?.origin || '';
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : '';
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

// Escape HTML to prevent injection in email body
function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

export const handler = async (event) => {
    const cors = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
    if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method not allowed' };

    // Require a valid Supabase member session
    const authed = await verifyMember(event);
    if (!authed) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;

    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, skipped: 'Email not configured' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { description, reporter, tail } = body;

    // Validate all inputs — reject oversized or wrong-type fields
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Description required' }) };
    }
    if (description.length > 1000) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Description too long' }) };
    }
    if (reporter && (typeof reporter !== 'string' || reporter.length > 200)) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Reporter field invalid' }) };
    }
    if (tail && (typeof tail !== 'string' || tail.length > 10)) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Tail number invalid' }) };
    }

    const safeDesc     = esc(description.trim());
    const safeReporter = esc(reporter || 'Unknown');
    const safeTail     = esc(tail || 'N/A');

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from:    'Hi-Line Flying Club <onboarding@resend.dev>',
            to:      [ADMIN_EMAIL],
            subject: `🛩️ New Squawk Reported — ${safeTail}`,
            html:    `
                <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
                    <h2 style="color:#2c3e50">New Squawk — ${safeTail}</h2>
                    <p><strong>Reported by:</strong> ${safeReporter}</p>
                    <p><strong>Description:</strong><br>${safeDesc}</p>
                    <hr>
                    <a href="https://n2134y.com/squawks.html"
                       style="background:#667eea;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:8px">
                        View Squawk Board
                    </a>
                </div>`
        })
    });

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: res.ok }) };
};
