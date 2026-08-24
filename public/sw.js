/* Gensar HRMS Service Worker
   - App shell (HTML/CSS/JS/icons) precached for offline use
   - API data (/api/*) is NEVER cached (privacy: attendance, payroll, PII)
   - Push notification handlers for installed PWA
   Bump CACHE_VERSION on every deploy that changes cached assets so clients
   pick up the new build instead of serving a stale app-shell forever. */
const CACHE_VERSION = 'v7';
const APP_SHELL_CACHE = 'gensar-app-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'gensar-runtime-' + CACHE_VERSION;
const RUNTIME_CACHE_MAX_ENTRIES = 100;

// Clean URLs (served by the Express portal routes); the legacy /pages/*.html
// paths keep working but are no longer what users navigate to.
const APP_SHELL_URLS = [
    '/',
    '/admin/',
    '/manifest.json',
    '/login',
    '/css/main.css',
    '/css/payroll.css',
    '/js/auth.js',
    '/js/dashboard.js',
    '/js/tickets.js',
    '/js/payroll-core.js',
    '/assets/images/gensar_logo.png',
    '/assets/images/fav-icon.png',
    '/assets/images/icon-192.png',
    '/assets/images/icon-512.png',
    '/assets/images/icon-maskable-512.png',
    '/assets/images/apple-touch-icon.png',
    '/admin/announcements',
    '/admin/attendance',
    '/admin/dashboard',
    '/admin/departments',
    '/admin/designations',
    '/admin/documents',
    '/admin/employees',
    '/admin/holidays',
    '/admin/leave',
    '/admin/onboarding',
    '/admin/payroll',
    '/admin/payroll-generate',
    '/admin/reports',
    '/admin/settings',
    '/admin/tickets',
    '/admin/wfh',
    '/employee/announcements',
    '/employee/attendance',
    '/employee/dashboard',
    '/employee/directory',
    '/employee/documents',
    '/employee/holidays',
    '/employee/leave',
    '/employee/onboarding',
    '/employee/payslips',
    '/employee/profile',
    '/employee/regularization',
    '/employee/tickets',
    '/employee/wfh',
    '/manager/my-team'
];

const CROSS_ORIGIN_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

// Font binaries referenced by the CSS above. Without caching these, offline
// mode shows blank boxes instead of icons/glyphs.
const CROSS_ORIGIN_PATTERNS = [
    /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/[^/]+\/webfonts\//,
    /^https:\/\/fonts\.gstatic\.com\//
];

function isCrossOriginAsset(url) {
    return CROSS_ORIGIN_URLS.includes(url.href) ||
        CROSS_ORIGIN_PATTERNS.some((re) => re.test(url.href));
}

// Keep the runtime cache bounded: evict the oldest entry when over capacity.
async function trimRuntimeCache() {
    const cache = await caches.open(RUNTIME_CACHE);
    const keys = await cache.keys();
    if (keys.length <= RUNTIME_CACHE_MAX_ENTRIES) return;
    for (const key of keys.slice(0, keys.length - RUNTIME_CACHE_MAX_ENTRIES)) {
        await cache.delete(key);
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_SHELL_CACHE);
        // Add entries individually so one failing URL (e.g. / or /admin/ behind the
        // serverless function) never blocks the rest of the app shell.
        await Promise.allSettled([
            ...APP_SHELL_URLS.map((url) =>
                cache.add(url).catch(() => {})
            ),
            ...CROSS_ORIGIN_URLS.map((url) =>
                fetch(url).then((res) => {
                    if (res.ok) return cache.put(url, res);
                }).catch(() => {})
            )
        ]);
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter((k) => k !== APP_SHELL_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

function isApiRequest(url) {
    return url.pathname.startsWith('/api/');
}

function isNavigationRequest(request) {
    return request.mode === 'navigate';
}

// Network-first with cache fallback for page navigations.
async function navigationHandler(request) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
            const cache = await caches.open(APP_SHELL_CACHE);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        const url = new URL(request.url);
        let cached = await caches.match(request);
        if (!cached && (url.pathname === '/admin' || url.pathname === '/admin/')) {
            cached = await caches.match('/admin/');
        }
        if (!cached) {
            cached = await caches.match('/');
        }
        return cached || Response.error();
    }
}

// Cache-first for static assets; refill cache in the background (stale-while-revalidate).
async function staticHandler(request) {
    const cached = await caches.match(request);
    const networkPromise = fetch(request).then((response) => {
        if (response && response.ok) {
            const cache = caches.open(request.url.startsWith(self.location.origin)
                ? APP_SHELL_CACHE
                : RUNTIME_CACHE);
            cache.then((c) => c.put(request, response.clone()));
            if (!request.url.startsWith(self.location.origin)) {
                cache.then(() => trimRuntimeCache());
            }
        }
        return response;
    }).catch(() => null);
    if (cached) return cached;
    // Cold cache + offline: never hand respondWith() a null (hard network
    // error) - return an explicit 504 instead.
    const fresh = await networkPromise;
    return fresh || new Response('Offline and not cached', {
        status: 504,
        statusText: 'Gateway Timeout',
        headers: { 'Content-Type': 'text/plain' }
    });
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Never cache API responses (privacy).
    if (isApiRequest(url)) return;

    if (isNavigationRequest(request)) {
        event.respondWith(navigationHandler(request));
        return;
    }

    // Same-origin static assets + cross-origin CDN (fonts, font-awesome).
    if (url.origin === self.location.origin || isCrossOriginAsset(url)) {
        event.respondWith(staticHandler(request));
    }
});

// Listen for a "skip waiting" message from the client (update flow).
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// ---------- Push notifications ----------

self.addEventListener('push', (event) => {
    let data = { title: 'Gensar HRMS', body: 'You have a new notification', url: '/' };
    try {
        if (event.data) {
            const parsed = event.data.json();
            data = Object.assign(data, parsed);
        }
    } catch (e) { /* keep defaults */ }

    event.waitUntil(self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/assets/images/icon-192.png',
        badge: '/assets/images/fav-icon.png',
        data: { url: data.url || '/' },
        tag: data.tag || (data.url ? 'gensar-hrms:' + data.url : 'gensar-hrms')
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil((async () => {
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

        // Already on the target page: just focus it.
        for (const client of allClients) {
            if (client.url && client.url.indexOf(targetUrl) !== -1) {
                await client.focus();
                return;
            }
        }

        // Otherwise navigate an existing window (fall back through all of them).
        for (const client of allClients) {
            if ('navigate' in client) {
                try {
                    await client.navigate(targetUrl);
                    await client.focus();
                    return;
                } catch (e) { /* try the next client */ }
            }
        }

        // No usable window: open the app (brings an installed PWA to the front).
        if (self.clients.openWindow) {
            await self.clients.openWindow(targetUrl);
        }
    })());
});
