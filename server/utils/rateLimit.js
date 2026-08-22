// Lightweight in-memory fixed-window rate limiter (no external dependency).
//
// Note: memory is per process/lambda. On Vercel serverless each instance keeps
// its own counters, but the limiter still raises the cost of brute-force and
// spraying attacks enormously compared to no limiting at all.

const buckets = new Map();
let lastSweep = Date.now();

function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function rateLimit(options = {}) {
    const windowMs = options.windowMs || 15 * 60 * 1000;
    const max = options.max || 10;
    const keyFn = options.keyFn || ((req) => clientIp(req));
    const message = options.message || 'Too many attempts. Please try again later.';

    return function rateLimitMiddleware(req, res, next) {
        const now = Date.now();

        // Occasional sweep so one-off keys don't accumulate forever.
        if (now - lastSweep > windowMs) {
            lastSweep = now;
            for (const [key, entry] of buckets) {
                if (entry.resetAt <= now) buckets.delete(key);
            }
        }

        const key = keyFn(req);
        let entry = buckets.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            buckets.set(key, entry);
        }
        entry.count += 1;

        if (entry.count > max) {
            res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
            return res.status(429).json({ success: false, message });
        }
        next();
    };
}

module.exports = { rateLimit, clientIp };
