const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'ログイン試行回数が多すぎます。しばらくしてから再度お試しください。' },
});

function timingSafeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
        // Still run a comparison of equal length to avoid leaking length via timing.
        crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

router.post('/login', loginLimiter, (req, res) => {
    const { password } = req.body || {};
    const expected = process.env.APP_PASSWORD;

    if (!expected) {
        return res.status(500).json({ error: 'サーバー側にパスワードが設定されていません。' });
    }
    if (!password || !timingSafeEqual(password, expected)) {
        return res.status(401).json({ error: 'パスワードが違います。' });
    }

    req.session.authenticated = true;
    res.json({ ok: true });
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ ok: true });
    });
});

router.get('/session', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

module.exports = router;
