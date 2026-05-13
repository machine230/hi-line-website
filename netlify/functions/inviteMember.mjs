// Netlify serverless function — invites a new club member via Supabase Auth
// Requires environment variables (set in Netlify dashboard):
//   SUPABASE_URL            — Supabase project URL
//   SUPABASE_SERVICE_ROLE   — Supabase → Settings → API → service_role secret key
//   SITE_URL                — e.g. https://n2134y.com (used for invite redirect URL)

import { createClient } from '@supabase/supabase-js';

// Only requests bearing a valid Supabase JWT from an admin member are allowed.
// We verify this by initialising a per-request client with the caller's JWT
// and checking their role in the members table.

const ALLOWED_ORIGINS = [
    'https://n2134y.com',
    'https://www.n2134y.com',
    'http://localhost:8888',
    'http://localhost:3000'
];
const NETLIFY_PREVIEW_RE = /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/;

function corsHeaders(event) {
    const origin = event.headers?.origin || '';
    const ok = ALLOWED_ORIGINS.includes(origin) || NETLIFY_PREVIEW_RE.test(origin);
    return {
        'Access-Control-Allow-Origin': ok ? origin : '',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
}

export const handler = async (event) => {
    const cors = corsHeaders(event);

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
    if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

    // ── Env checks ──
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE;
    const supabaseUrl = process.env.SUPABASE_URL;
    const siteUrl     = process.env.SITE_URL || 'https://n2134y.com';

    if (!serviceRole || !supabaseUrl) {
        return { statusCode: 500, headers: cors,
            body: JSON.stringify({ error: 'Server not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE env vars in Netlify.' }) };
    }

    // ── Service role client (elevated — only used server-side) ──
    const admin = createClient(supabaseUrl, serviceRole, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    // ── Verify caller is an admin using their JWT ──
    const authHeader = event.headers?.authorization || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!jwt) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Not authenticated' }) };

    // Validate the JWT by calling the Supabase auth REST endpoint directly.
    // SDK-based approaches (auth.getUser / user-context client) have unreliable
    // behaviour server-side with a service-role client, so we call the endpoint raw.
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!anonKey) {
        return { statusCode: 500, headers: cors,
            body: JSON.stringify({ error: 'SUPABASE_ANON_KEY not configured in Netlify env vars' }) };
    }
    let userId, userData;
    try {
        const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'apikey': anonKey
            }
        });
        if (!authRes.ok) {
            const errBody = await authRes.text();
            console.error('[inviteMember] auth/v1/user error:', authRes.status, errBody);
            return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid session' }) };
        }
        userData = await authRes.json();
        userId = userData?.id;
    } catch (e) {
        console.error('[inviteMember] fetch auth error:', e?.message || e);
        return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Auth check failed' }) };
    }
    if (!userId) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid session' }) };

    // Look up caller's role — try by auth user ID first, then fall back to email.
    // Uses .limit(1) + array access instead of .single() to avoid null returns
    // when the members row ID differs from the auth.users UUID.
    let callerMember = null;

    const { data: idRows, error: idErr } = await admin
        .from('members').select('role, email').eq('id', userId).limit(1);
    console.log('[inviteMember] byId lookup:', JSON.stringify({ userId, found: idRows?.length ?? 0, error: idErr?.message }));

    if (idRows?.length) {
        callerMember = idRows[0];
    } else if (userData?.email) {
        const { data: emailRows, error: emailErr } = await admin
            .from('members').select('role, email').eq('email', userData.email).limit(1);
        console.log('[inviteMember] byEmail lookup:', JSON.stringify({ email: userData.email, found: emailRows?.length ?? 0, role: emailRows?.[0]?.role, error: emailErr?.message }));
        if (emailRows?.length) callerMember = emailRows[0];
    }

    console.log('[inviteMember] callerMember:', JSON.stringify(callerMember));

    if (!['admin', 'super_admin'].includes(callerMember?.role)) {
        return { statusCode: 403, headers: cors,
            body: JSON.stringify({ error: 'Admin access required' }) };
    }

    // ── Parse body ──
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const name  = (body.name  || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const phone = (body.phone || '').trim() || null;
    const role  = ['member', 'ap', 'admin'].includes(body.role) ? body.role : 'member';

    if (!name  || name.length < 2 || name.length > 100)       return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Name must be 2–100 characters' }) };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Valid email required' }) };

    // ── Step 1: Send Supabase auth invite ──
    // Must happen BEFORE the members upsert because members.id is a FK to auth.users.id.
    // inviteUserByEmail creates the auth.users record and returns the UUID we need.
    const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/auth-callback.html`,
        data: { name }
    });

    let authUserId  = inviteData?.user?.id;
    let alreadyExists = false;

    if (inviteErr) {
        if (inviteErr.message?.includes('already been registered')) {
            // Auth user already exists — look up their UUID from auth so we can
            // still upsert the member record correctly.
            alreadyExists = true;
            const { data: listData } = await admin.auth.admin.listUsers({ perPage: 1000 });
            const existing = listData?.users?.find(u => u.email === email);
            authUserId = existing?.id ?? null;
        } else {
            console.error('[inviteMember] Auth invite error:', inviteErr);
            return { statusCode: 500, headers: cors,
                body: JSON.stringify({ error: 'Invite email failed: ' + inviteErr.message }) };
        }
    }

    if (!authUserId) {
        console.error('[inviteMember] Could not resolve auth user ID for', email);
        return { statusCode: 500, headers: cors,
            body: JSON.stringify({ error: 'Could not resolve auth account for this email' }) };
    }

    // ── Step 2: Insert or update member record ──
    // Avoid upsert(onConflict:'email') which requires a unique index on email.
    // Instead: check if a row exists by email, then UPDATE or INSERT.
    const { data: existingRows } = await admin
        .from('members').select('id').eq('email', email).limit(1);

    if (existingRows?.length) {
        // Member row already exists — update it (keep existing id/pk intact)
        const { error: updErr } = await admin.from('members')
            .update({ name, phone, role, membership_active: true })
            .eq('email', email);
        if (updErr) {
            console.error('[inviteMember] DB update error:', updErr);
            return { statusCode: 500, headers: cors,
                body: JSON.stringify({ error: 'Failed to update member: ' + updErr.message }) };
        }
    } else {
        // New member — insert with the auth UUID as primary key
        const { error: insErr } = await admin.from('members').insert(
            { id: authUserId, name, email, phone, role, membership_active: true, pic_status: false }
        );
        if (insErr) {
            console.error('[inviteMember] DB insert error:', insErr);
            return { statusCode: 500, headers: cors,
                body: JSON.stringify({ error: 'Failed to save member: ' + insErr.message }) };
        }
    }

    if (alreadyExists) {
        return { statusCode: 200, headers: cors,
            body: JSON.stringify({ ok: true, alreadyExists: true,
                message: `${name} already has an account. Member record updated.` }) };
    }

    return { statusCode: 200, headers: cors,
        body: JSON.stringify({ ok: true, message: `Invite sent to ${email}. They'll receive an email to set their password and log in.` }) };
};
