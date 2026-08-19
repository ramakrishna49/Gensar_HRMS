let TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';

function setTimezone(tz) {
    if (tz) TIMEZONE = tz;
}

function getTimezone() {
    return TIMEZONE;
}

// Current date as YYYY-MM-DD in the office timezone (IST by default).
// Server may run on UTC (Vercel), so Date.toISOString() would give the wrong day.
function istDateString(date) {
    return (date instanceof Date ? date : new Date())
        .toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

// Current time as HH:MM:SS (24h) in the office timezone.
function istTimeString(date) {
    return (date instanceof Date ? date : new Date())
        .toLocaleTimeString('en-GB', { timeZone: TIMEZONE, hour12: false });
}

// Current month (1-12) in the office timezone.
function istMonth() {
    return parseInt(new Date().toLocaleDateString('en-US', { timeZone: TIMEZONE, month: 'numeric' }), 10);
}

// Current year in the office timezone.
function istYear() {
    return parseInt(new Date().toLocaleDateString('en-US', { timeZone: TIMEZONE, year: 'numeric' }), 10);
}

module.exports = { TIMEZONE, setTimezone, getTimezone, istDateString, istTimeString, istMonth, istYear };
