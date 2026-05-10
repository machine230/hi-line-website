// Netlify Scheduled Function — reservationReminder
// Fires daily at 14:00 UTC (6 AM PT / 7 AM MT).
// Emails every member who has a confirmed reservation the following day.
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE, RESEND_API_KEY

import { createClient } from '@supabase/supabase-js';

export const config = { schedule: '0 14 * * *' };

function esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

export default async () => {
    const SUPABASE_URL     = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE;
    const RESEND_API_KEY   = process.env.RESEND_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE) {
        console.error('[reservationReminder] Missing Supabase env vars');
        return;
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    // Build tomorrow's date window (UTC-aware)
    const now       = new Date();
    const tomorrow  = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tDate     = tomorrow.toISOString().split('T')[0];  // YYYY-MM-DD
    const dayStart  = `${tDate}T00:00:00`;
    const dayEnd    = `${tDate}T23:59:59`;

    const { data: reservations, error } = await supabase
        .from('reservations')
        .select('id, start_time, end_time, airplanes(tail_number), members(email, name)')
        .gte('start_time', dayStart)
        .lte('start_time', dayEnd)
        .eq('status', 'confirmed');

    if (error) {
        console.error('[reservationReminder] DB error:', error?.message || error);
        return;
    }

    if (!reservations?.length) {
        console.log('[reservationReminder] No reservations tomorrow — done.');
        return;
    }

    if (!RESEND_API_KEY) {
        console.warn('[reservationReminder] RESEND_API_KEY not set — skipping emails');
        return;
    }

    const fmt = (iso) =>
        new Date(iso).toLocaleTimeString('en-US', {
            timeZone: 'America/Los_Angeles',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

    const results = await Promise.allSettled(reservations.map(async (r) => {
        const member   = r.members;
        const airplane = r.airplanes;
        if (!member?.email) return;

        const safeName  = esc(member.name?.split(' ')[0] || 'Pilot');
        const safeTail  = esc(airplane?.tail_number || 'your aircraft');
        const startTime = fmt(r.start_time);
        const endTime   = fmt(r.end_time);
        const dateStr   = new Date(r.start_time).toLocaleDateString('en-US', {
            timeZone: 'America/Los_Angeles',
            weekday: 'long', month: 'long', day: 'numeric'
        });

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from:    'Hi-Line Flying Club <onboarding@resend.dev>',
                to:      [member.email],
                subject: `Reminder: ${safeTail} tomorrow at ${startTime}`,
                html: `
                    <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
                        <h2 style="color:#2c3e50">Flight Reminder — ${safeTail}</h2>
                        <p>Hi ${safeName},</p>
                        <p>Just a friendly reminder that you have <strong>${safeTail}</strong> reserved tomorrow:</p>
                        <div style="background:#FFF8EE;border-left:4px solid #E8A030;padding:14px 18px;border-radius:4px;margin:16px 0">
                            <p style="margin:0"><strong>${dateStr}</strong></p>
                            <p style="margin:4px 0 0;color:#555">${startTime} – ${endTime} PT</p>
                        </div>
                        <p>Check the squawk board before departure and confirm the aircraft is available.</p>
                        <a href="${process.env.SITE_URL || 'https://n2134y.com'}/schedule.html"
                           style="background:#E8A030;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin-top:8px">
                            View Schedule →
                        </a>
                        <p style="margin-top:20px;font-size:0.85em;color:#888">Safe skies — Hi-Line Flying Club</p>
                    </div>`
            })
        });

        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error(`[reservationReminder] Resend error for ${member.email}:`, res.status, txt);
        }
    }));

    const sent   = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    console.log(`[reservationReminder] Done — ${sent} sent, ${failed} failed`);
};
