// Manages the login password as a runtime-editable DB value instead of a
// static .env value, so it can be changed from the UI without a server restart.
//
// Backed by the `users` table. Only a single row (DEFAULT_USERNAME) is used
// today since there's just one shared login - but shaping this as a users
// table now (rather than a generic settings blob) means adding real per-person
// ID+password login later is just "add more rows" and a username field on the
// login form, not a schema change.
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const DEFAULT_USERNAME = 'admin';

async function getPasswordHash(username = DEFAULT_USERNAME) {
    const result = await pool.query('SELECT password_hash FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0) return result.rows[0].password_hash;
    return null;
}

async function setPasswordHash(hash, username = DEFAULT_USERNAME) {
    await pool.query(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2)
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
        [username, hash]
    );
}

// Seeds the default user from APP_PASSWORD on first run so existing deployments
// keep working without any manual migration step. Once that user exists,
// APP_PASSWORD is ignored from then on - the "change password" feature is the
// source of truth after that point.
async function ensurePasswordSeeded() {
    const existing = await getPasswordHash();
    if (existing) return;

    const envPassword = process.env.APP_PASSWORD;
    if (!envPassword) {
        console.warn('No users row and no APP_PASSWORD env var set - login will fail until a password is configured.');
        return;
    }
    const hash = await bcrypt.hash(envPassword, 10);
    await setPasswordHash(hash);
    console.log('Seeded initial login user/password from APP_PASSWORD env var.');
}

module.exports = { getPasswordHash, setPasswordHash, ensurePasswordSeeded };
