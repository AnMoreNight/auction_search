require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const compression = require('compression');

const { pool } = require('./db');
const { ensurePasswordSeeded } = require('./authStore');
const requireAuth = require('./middleware/requireAuth');
const authRoutes = require('./routes/auth');
const searchRoutes = require('./routes/search');
const uploadRoutes = require('./routes/upload');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());

app.use(
    session({
        store: new pgSession({ pool, createTableIfMissing: true }),
        secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            // Deliberately NOT tied to NODE_ENV: a Secure cookie is only ever sent
            // by the browser over HTTPS, so turning this on before HTTPS is actually
            // configured (see DEPLOY.md) silently breaks login - the cookie gets set
            // on login but never sent back on the next request. Opt in explicitly
            // once HTTPS is live.
            secure: process.env.COOKIE_SECURE === 'true',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        },
    })
);

// Public auth endpoints (login must work without being authenticated yet)
app.use('/api', authRoutes);

// Everything else under /api requires a valid session
app.use('/api', requireAuth, searchRoutes);
app.use('/api', requireAuth, uploadRoutes);

// Static frontend (index.html itself checks session client-side and
// redirects to login.html when not authenticated - see public/js/app.js).
// No maxAge: express.static still sends ETag/Last-Modified, so browsers
// revalidate (cheap 304s) instead of blindly serving a stale cached copy
// for up to an hour after a deploy.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました。' });
});

ensurePasswordSeeded()
    .catch((err) => console.error('Failed to seed initial password:', err))
    .finally(() => {
        app.listen(PORT, () => {
            console.log(`Auction search server listening on port ${PORT}`);
        });
    });
