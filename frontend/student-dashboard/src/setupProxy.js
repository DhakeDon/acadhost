const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
    app.use(
        '/api',
        createProxyMiddleware({
            target: 'http://localhost:3000',
            changeOrigin: true,
            cookieDomainRewrite: 'localhost',
            pathRewrite: (path) => `/api${path}`,  // keep the /api prefix
        })
    );
};