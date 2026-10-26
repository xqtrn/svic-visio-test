// Global 401 handler — redirect to login when session expires
(function() {
    const _fetch = window.fetch;
    window.fetch = async function(...args) {
        const resp = await _fetch.apply(this, args);
        if (resp.status === 401) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (url.startsWith('/api/')) {
                window.location.href = '/login?error=expired';
                return resp;
            }
        }
        // Новый участник без фото (src/services/member-photo.js): любой запрос
        // к /api/ отвечает 428 — туда, куда велит сервер: незаконченный первый
        // вход (photoPage = /onboarding, шаг Details собирает фото) или страница
        // фото, затем назад туда, где он был.
        if (resp.status === 428 && !/^\/(my-photo|onboarding)(\/|$)/.test(window.location.pathname)) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
            if (url.startsWith('/api/')) {
                let page = '/my-photo';
                try { const body = await resp.clone().json(); if (body && body.photoPage === '/onboarding') page = '/onboarding'; } catch (_) {}
                window.location.href = page === '/onboarding' ? page : '/my-photo?next=' + encodeURIComponent(window.location.pathname + window.location.search);
                return resp;
            }
        }
        return resp;
    };
})();
