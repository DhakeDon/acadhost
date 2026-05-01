// src/setupProxy.js
// CRA auto-loads this in dev. Forwards /api/* from the CRA dev server
// (localhost:5173) to the Express backend (localhost:3002 in dev).
//
// IMPORTANT: Uses http-proxy-middleware v3 syntax. In v3, app.use('/api', ...)
// strips /api before the proxy sees it, so we mount at '/' and use a
// `pathFilter` that only matches /api/*. The original path is then preserved.
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
    app.use(
        createProxyMiddleware({
            pathFilter: '/api/**',
            target: 'http://localhost:3000',
            changeOrigin: true,
            cookieDomainRewrite: 'localhost',
            logger: console, // v3 uses `logger`, not `logLevel`
        })
    );
};