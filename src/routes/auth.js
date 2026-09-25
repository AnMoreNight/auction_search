const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const requireAuth = require('../middleware/requireAuth');
const { getPasswordHash, setPasswordHash, ADMIN_USERNAME } = require('../authStore');

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

function validateNewPassword(newPassword) {
    if (!newPassword || String(newPassword).length < 4) {
        return '新しいパスワードは4文字以上で入力してください。';
    }
    if (String(newPassword).length > 200) {
        return '新しいパスワードが長すぎます。';
    }
    return null;
}

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

// Changes the shared login password. Gated by the separate admin password so
// knowing the (widely shared) login password isn't enough to change it.
router.post('/change-password', requireAuth, changePasswordLimiter, async (req, res) => {
    try {
        const { adminPassword, newPassword } = req.body || {};

        const adminHash = await getPasswordHash(ADMIN_USERNAME);
        if (!adminHash) {
            return res.status(500).json({ error: 'サーバー側に管理者パスワードが設定されていません。' });
        }
        if (!adminPassword || !(await bcrypt.compare(String(adminPassword), adminHash))) {
            return res.status(401).json({ error: '管理者パスワードが正しくありません。' });
        }

        const validationError = validateNewPassword(newPassword);
        if (validationError) return res.status(400).json({ error: validationError });

        const newHash = await bcrypt.hash(String(newPassword), 10);
        await setPasswordHash(newHash);
        res.json({ ok: true });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: 'パスワード変更中にエラーが発生しました。' });
    }
});

// Changes the admin password itself. Gated by knowing the CURRENT admin
// password (standard change-your-own-password pattern).
router.post('/change-admin-password', requireAuth, changePasswordLimiter, async (req, res) => {
    try {
        const { currentAdminPassword, newAdminPassword } = req.body || {};

        const adminHash = await getPasswordHash(ADMIN_USERNAME);
        if (!adminHash) {
            return res.status(500).json({ error: 'サーバー側に管理者パスワードが設定されていません。' });
        }
        if (!currentAdminPassword || !(await bcrypt.compare(String(currentAdminPassword), adminHash))) {
            return res.status(401).json({ error: '現在の管理者パスワードが正しくありません。' });
        }

        const validationError = validateNewPassword(newAdminPassword);
        if (validationError) return res.status(400).json({ error: validationError });

        const newHash = await bcrypt.hash(String(newAdminPassword), 10);
        await setPasswordHash(newHash, ADMIN_USERNAME);
        res.json({ ok: true });
    } catch (err) {
        console.error('Change admin password error:', err);
        res.status(500).json({ error: '管理者パスワード変更中にエラーが発生しました。' });
    }
});

module.exports = router;
