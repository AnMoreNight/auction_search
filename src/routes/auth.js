const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const requireAuth = require('../middleware/requireAuth');
const { getPasswordHash, setPasswordHash } = require('../authStore');

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'ログイン試行回数が多すぎます。しばらくしてから再度お試しください。' },
});

const changePasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '試行回数が多すぎます。しばらくしてから再度お試しください。' },
});

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { password } = req.body || {};
        const hash = await getPasswordHash();

        if (!hash) {
            return res.status(500).json({ error: 'サーバー側にパスワードが設定されていません。' });
        }
        if (!password || !(await bcrypt.compare(String(password), hash))) {
            return res.status(401).json({ error: 'パスワードが違います。' });
        }

        req.session.authenticated = true;
        res.json({ ok: true });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'ログイン処理中にエラーが発生しました。' });
    }
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

router.post('/change-password', requireAuth, changePasswordLimiter, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};

        if (!newPassword || String(newPassword).length < 4) {
            return res.status(400).json({ error: '新しいパスワードは4文字以上で入力してください。' });
        }
        if (String(newPassword).length > 200) {
            return res.status(400).json({ error: '新しいパスワードが長すぎます。' });
        }

        const hash = await getPasswordHash();
        if (!hash || !currentPassword || !(await bcrypt.compare(String(currentPassword), hash))) {
            return res.status(401).json({ error: '現在のパスワードが正しくありません。' });
        }

        const newHash = await bcrypt.hash(String(newPassword), 10);
        await setPasswordHash(newHash);
        res.json({ ok: true });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: 'パスワード変更中にエラーが発生しました。' });
    }
});

module.exports = router;
