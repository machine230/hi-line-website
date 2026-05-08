// Netlify serverless function — handles waitlist form submissions
// Sends email to admin via Resend. No auth required (public form).
// Requires: RESEND_API_KEY, ADMIN_EMAIL env vars in Netlify dashboard.

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
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };
}

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

export const handler = async (event) => {
    const cors = corsHeaders(event);

    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
    if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    // Honeypot — bots fill this hidden field; humans leave it blank
    if (body.website) return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };

    const name    = (body.name    || '').trim();
    const email   = (body.email   || '').trim().toLowerCase();
    const phone   = (body.phone   || '').trim();
    const cert    = (body.cert    || '').trim();
    const hours   = (body.hours   || '').trim();
    const message = (body.message || '').trim();

    // Validation
    if (!name  || name.length < 2  || name.length > 100)        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Name must be 2–100 characters' }) };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))   return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Valid email required' }) };
    if (message.length > 2000) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Message too long' }) };

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;

    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
        console.warn('[joinWaitlist] Email env vars not set — logging submission only');
        console.log('[joinWaitlist] Submission:', JSON.stringify({ name, email, phone, cert, hours }));
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    const certLabel = esc(cert || 'Not specified');
    const hoursLabel = esc(hours || 'Not specified');

    const html = `
    <div style="font-family:'Open Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0F1923;border-radius:10px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1A2A3A,#0F1923);padding:28px 32px;border-bottom:3px solid #E8A030">
        <p style="margin:0 0 4px;font-family:'Montserrat',Arial,sans-serif;font-size:0.8em;font-weight:700;color:#E8A030;letter-spacing:2px;text-transform:uppercase">Hi-Line Flying Club</p>
        <h2 style="margin:0;font-family:'Montserrat',Arial,sans-serif;font-size:1.45em;font-weight:900;color:#fff">New Waitlist Application ✈️</h2>
      </div>
      <div style="padding:28px 32px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:rgba(255,255,255,0.45);font-size:0.82em;width:38%">Full Name</td>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:#fff;font-size:0.9em;font-weight:600">${esc(name)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:rgba(255,255,255,0.45);font-size:0.82em">Email</td>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:#5BB8E8;font-size:0.9em"><a href="mailto:${esc(email)}" style="color:#5BB8E8">${esc(email)}</a></td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:rgba(255,255,255,0.45);font-size:0.82em">Phone</td>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:#fff;font-size:0.9em">${phone ? esc(phone) : '<span style="color:rgba(255,255,255,0.3)">Not provided</span>'}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:rgba(255,255,255,0.45);font-size:0.82em">Pilot Certificate</td>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:#fff;font-size:0.9em">${certLabel}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:rgba(255,255,255,0.45);font-size:0.82em">Total Hours</td>
            <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.07);color:#fff;font-size:0.9em">${hoursLabel}</td>
          </tr>
        </table>
        ${message ? `
        <div style="margin-top:20px">
          <p style="color:rgba(255,255,255,0.45);font-size:0.82em;margin:0 0 8px">Message / Background</p>
          <p style="color:rgba(255,255,255,0.85);font-size:0.88em;line-height:1.7;background:rgba(255,255,255,0.04);border-radius:6px;padding:14px 16px;border-left:3px solid #E8A030;margin:0">${esc(message).replace(/\n/g,'<br>')}</p>
        </div>` : ''}
        <div style="margin-top:28px;text-align:center">
          <a href="mailto:${esc(email)}" style="display:inline-block;background:#E8A030;color:#fff;text-decoration:none;font-family:'Montserrat',Arial,sans-serif;font-weight:700;font-size:0.88em;padding:12px 28px;border-radius:6px">Reply to ${esc(name)} →</a>
        </div>
      </div>
      <div style="padding:16px 32px;background:rgba(0,0,0,0.2);text-align:center;font-size:0.75em;color:rgba(255,255,255,0.25)">
        Submitted via n2134y.com · Hi-Line Flying Club · KRNT
      </div>
    </div>`;

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from:     'Hi-Line Flying Club <onboarding@resend.dev>',
            to:       [ADMIN_EMAIL],
            reply_to: email,
            subject:  `✈️ New Waitlist Application — ${esc(name)}`,
            html
        })
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error('[joinWaitlist] Resend error:', res.status, errText);
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Failed to send email. Please try again.' }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
};
