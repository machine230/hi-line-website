// Netlify Function — notifyWaitlist
// Called by squawks.html when an airplane is returned to airworthy status.
// Emails all waitlisted members, then clears the waitlist.
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY, ADMIN_EMAIL

import { createClient } from '@supabase/supabase-js';

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

// Returns the caller's auth user ID, or null if JWT is missing/invalid.
async function getCallerUserId(event, supabaseUrl) {
    const jwt = (event.headers?.authorization || '').replace('Bearer ', '').trim();
    if (!jwt) return null;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!anonKey) return null;
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

    const SUPABASE_URL      = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE  = process.env.SUPABASE_SERVICE_ROLE;
    const RESEND_API_KEY    = process.env.RESEND_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE) {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server not configured' }) };
    }

    // Require a valid Supabase session and admin/A&P role
    const callerUserId = await getCallerUserId(event, SUPABASE_URL);
    if (!callerUserId) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);
    const { data: callerMember } = await supabase
        .from('members').select('role').eq('id', callerUserId).single();
    if (!['admin', 'ap'].includes(callerMember?.role)) {
        return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Admin or A&P access required' }) };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { airplane_id } = body;
    if (!airplane_id || typeof airplane_id !== 'string' || airplane_id.length > 64) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid airplane_id' }) };
    }

    // Get airplane tail number
    const { data: airplane } = await supabase
        .from('airplanes')
        .select('tail_number')
        .eq('id', airplane_id)
        .single();

    if (!airplane) {
        return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Airplane not found' }) };
    }

    // Get all waitlisted members for this airplane
    const { data: waitlist } = await supabase
        .from('waitlist')
        .select('member_id, members(email, name)')
        .eq('airplane_id', airplane_id);

    if (!waitlist?.length) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, notified: 0 }) };
    }

    // Send emails if Resend is configured
    if (RESEND_API_KEY) {
        const safeTail = esc(airplane.tail_number);
        await Promise.allSettled(waitlist.map(async (w) => {
            const member = w.members;
            if (!member?.email) return;
            const safeName = esc(member.name?.split(' ')[0] || 'Pilot');
            await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from:    'Hi-Line Flying Club <onboarding@resend.dev>',
                    to:      [member.email],
                    subject: `✅ ${safeTail} is back in service`,
                    html:    `
                        <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
                            <h2 style="color:#2c3e50">${safeTail} — Back in Service</h2>
                            <p>Hi ${safeName},</p>
                            <p>Good news — <strong>${safeTail}</strong> has been returned to airworthy status and is available to fly.</p>
                            <p>You were on the waitlist, so we wanted you to know first. Log in to schedule your flight.</p>
                            <a href="${process.env.SITE_URL || 'https://n2134y.com'}/schedule.html"
                               style="background:#E8A030;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px">
                                Book a Flight →
                            </a>
                            <p style="margin-top:20px;font-size:0.85em;color:#888">Safe skies — Hi-Line Flying Club</p>
                        </div>`
                })
            });
        }));
    }

    // Clear the waitlist for this airplane
    await supabase.from('waitlist').delete().eq('airplane_id', airplane_id);

    return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ ok: true, notified: waitlist.length })
    };
};
