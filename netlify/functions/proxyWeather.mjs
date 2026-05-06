// Netlify serverless function — proxies NOAA aviation weather API
// Needed because NOAA doesn't send CORS headers for browser requests

const ALLOWED_ORIGINS = [
    'https://n2134y.com',
    'https://www.n2134y.com',
    'http://localhost:8888',
    'http://localhost:3000'
];

// Netlify deploy preview pattern — matches any branch/PR preview URL
const NETLIFY_PREVIEW_RE = /^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/;

// Only allow A-Z and 0-9 in ICAO codes (strict whitelist)
const ICAO_RE = /^[A-Z0-9]{3,4}$/;

function getCorsHeaders(event) {
    const origin = event.headers?.origin || '';
    const isAllowed = ALLOWED_ORIGINS.includes(origin) || NETLIFY_PREVIEW_RE.test(origin);
    const allowed = isAllowed ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };
}

export const handler = async (event) => {
    const cors = getCorsHeaders(event);

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: cors, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, headers: cors, body: 'Method not allowed' };
    }

    const icao = (event.queryStringParameters?.icao || '').toUpperCase().trim();

    if (!icao || !ICAO_RE.test(icao)) {
        return {
            statusCode: 400,
            headers: cors,
            body: JSON.stringify({ error: 'Valid ICAO code required (3-4 alphanumeric characters)' })
        };
    }

    try {
        const base = 'https://aviationweather.gov/api/data';
        const [metarRes, tafRes, airportRes] = await Promise.all([
            fetch(`${base}/metar?ids=${icao}&format=json&hours=2`),
            fetch(`${base}/taf?ids=${icao}&format=json`),
            fetch(`${base}/airport?ids=${icao}&format=json`)
        ]);

        // NOAA returns 204 No Content for airports with no data
        const metar   = (metarRes.ok   && metarRes.status   !== 204) ? await metarRes.json()   : [];
        const taf     = (tafRes.ok     && tafRes.status     !== 204) ? await tafRes.json()     : [];
        const airport = (airportRes.ok && airportRes.status !== 204) ? await airportRes.json() : [];

        return {
            statusCode: 200,
            headers: cors,
            body: JSON.stringify({ metar, taf, airport })
        };

    } catch (err) {
        return {
            statusCode: 500,
            headers: cors,
            body: JSON.stringify({ error: 'Failed to fetch weather data' })
        };
    }
};
