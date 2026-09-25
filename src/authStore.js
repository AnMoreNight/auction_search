// Manages both the shared login password and the admin password as
// runtime-editable DB values instead of static .env values, so both can be
// changed from the UI without a server restart.
//
// Backed by the `users` table, using two fixed rows:
//   - LOGIN_USERNAME: the shared password everyone uses to log in and search.
//   - ADMIN_USERNAME: a separate secret required to change the login password,
//     and to change itself. Not used to log in to the app.
// Shaping this as a users table (rather than a generic settings blob) means
// adding real per-person ID+password login later is just "add more rows" and
// a username field on the login form, not a schema change.
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const LOGIN_USERNAME = 'admin';
const ADMIN_USERNAME = 'admin_secret';

async function getPasswordHash(username = LOGIN_USERNAME) {
    const result = await pool.query('SELECT password_hash FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0) return result.rows[0].password_hash;
    return null;
}

async function setPasswordHash(hash, username = LOGIN_USERNAME) {
    await pool.query(
        `INSERT INTO users (username, password_hash) VALUES ($1, $2)
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
        [username, hash]
    );
}

async function seedIfMissing(username, envValue, label) {
    const existing = await getPasswordHash(username);
    if (existing) return;

    if (!envValue) {
        console.warn(`No "${username}" row and no seed env var set for ${label} - it will fail until configured.`);
        return;
    }
    const hash = await bcrypt.hash(envValue, 10);
    await setPasswordHash(hash, username);
    console.log(`Seeded initial ${label} from env var.`);
}

// Seeds both credentials on first run so existing deployments keep working
// without any manual migration step. Once a row exists, its env var is
// ignored from then on - the in-app "change password" features are the
// source of truth after that point.
async function ensurePasswordSeeded() {
    await seedIfMissing(LOGIN_USERNAME, process.env.APP_PASSWORD, 'login password');
    await seedIfMissing(ADMIN_USERNAME, process.env.ADMIN_PASSWORD, 'admin password');
}

module.exports = {
    getPasswordHash,
    setPasswordHash,
    ensurePasswordSeeded,
    LOGIN_USERNAME,
    ADMIN_USERNAME,
};
