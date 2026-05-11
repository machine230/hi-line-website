// ─────────────────────────────────────────────────────────────
//  aircraft-utils.js — Shared aircraft state helpers
//  Include on every page that reads aircraft status.
// ─────────────────────────────────────────────────────────────

/**
 * getEffectiveStatus(plane)
 *
 * Derives the live aircraft status from the airplane row at render time.
 * Never relies on a scheduled DB write — status is always accurate.
 *
 * Priority:
 *   1. Active grounding window (grounded_from ≤ now < grounded_until) → 'maintenance'
 *   2. Stored status field (available, squawk, flying, grounded)       → as-is
 *
 * This means:
 *   - Scheduling a future grounding does NOT immediately ground the plane
 *   - The plane re-enters 'available' the moment grounded_until passes
 *   - Admin clearing grounded_from/grounded_until takes effect immediately
 *
 * @param {object} plane - Airplane row from Supabase (needs grounded_from, grounded_until, status)
 * @returns {string} - 'available' | 'flying' | 'maintenance' | 'squawk' | 'grounded'
 */
function getEffectiveStatus(plane) {
    if (!plane) return 'available';

    const now    = new Date();
    const gFrom  = plane.grounded_from  ? new Date(plane.grounded_from)  : null;
    const gUntil = plane.grounded_until ? new Date(plane.grounded_until) : null;

    // Active grounding window: started in the past, not yet ended (or no end = indefinite)
    if (gFrom && gFrom <= now && (!gUntil || gUntil > now)) {
        return 'maintenance';
    }

    return plane.status || 'available';
}

/**
 * getStatusLabel(status)
 * Human-readable label for each status value.
 */
function getStatusLabel(status) {
    const labels = {
        available:   'Available',
        flying:      'Flying',
        maintenance: 'Maintenance',
        squawk:      'Squawk',
        grounded:    'Grounded'
    };
    return labels[status] || 'Unknown';
}

/**
 * getStatusColor(status)
 * Returns a CSS variable or hex string for status badge coloring.
 */
function getStatusColor(status) {
    const colors = {
        available:   '#22c55e',   // green
        flying:      '#4A9ECC',   // sky blue
        maintenance: '#E8A030',   // amber
        squawk:      '#f97316',   // orange
        grounded:    '#ef4444'    // red
    };
    return colors[status] || '#94a3b8';
}

/**
 * getUpcomingGroundingLabel(plane)
 * Returns a string like "Maintenance scheduled: Tue May 13, 8 AM"
 * if a future grounding window exists but hasn't started yet.
 * Returns null if no upcoming grounding.
 */
function getUpcomingGroundingLabel(plane) {
    if (!plane?.grounded_from) return null;
    const now   = new Date();
    const gFrom = new Date(plane.grounded_from);
    if (gFrom <= now) return null; // already active or past

    const label = gFrom.toLocaleDateString('en-US', {
        timeZone:    CLUB.timezone,
        weekday:     'short',
        month:       'short',
        day:         'numeric',
        hour:        'numeric',
        minute:      '2-digit',
        hour12:      true
    });
    return `Maintenance scheduled: ${label}`;
}
