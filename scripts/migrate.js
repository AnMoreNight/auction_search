// Applies db/schema.sql to the database configured in .env
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    try {
        await pool.query(sql);
        console.log('Schema applied successfully.');
    } catch (err) {
        console.error('Failed to apply schema:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
