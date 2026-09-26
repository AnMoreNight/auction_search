# Deployment Guide — ConoHa VPS (Ubuntu 24.04)

Step-by-step instructions to set up, install, and migrate data for the Auction
Price Database Search System on a ConoHa VPS. Run all commands as a
non-root sudo user unless noted otherwise.

Architecture recap:

```
PC / Smartphone → HTTPS → Nginx → Node.js (Express) → PostgreSQL
```

---

## 1. Provision the VPS

1. In the ConoHa control panel, create a new VPS:
   - OS image: **Ubuntu 24.04**
   - Plan: any plan with at least 2GB RAM is comfortable for ~100k rows +
     weekly imports (1GB works but keep an eye on memory during bulk import).
   - Set a root password or upload an SSH public key during creation.
2. Note the VPS's public IP address from the control panel.
3. Connect for the first time:
   ```bash
   ssh root@<your-vps-ip>
   ```

## 2. Basic server setup

Create a non-root user and lock down SSH/firewall basics.

```bash
adduser deploy
usermod -aG sudo deploy

# Optional but recommended: copy your SSH key to the new user
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Switch to the new user for everything from here on
su - deploy
```

Enable the firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```

Update the system:

```bash
sudo apt update && sudo apt upgrade -y
```

## 3. Install Node.js

Install Node.js 18+ via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v20.x
npm -v
```

## 4. Install PostgreSQL and enable pg_trgm

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

Create the database and user:

```bash
sudo -u postgres psql
```

Inside the `psql` prompt:

```sql
CREATE DATABASE auction_db;
CREATE USER auction_user WITH PASSWORD 'CHANGE_ME_TO_A_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE auction_db TO auction_user;
\c auction_db
GRANT ALL ON SCHEMA public TO auction_user;
\q
```

The `pg_trgm` extension itself is created automatically by the app's
`db/schema.sql` (see step 8), so no manual step is needed here — just make
sure `postgresql-contrib` is installed (it ships `pg_trgm`).

## 5. Install Nginx

```bash
sudo apt install -y nginx
sudo ufw allow 'Nginx Full'
sudo systemctl enable --now nginx
```

## 6. Get the application code onto the server

Pick one of the following depending on how you're distributing the code.

**Option A — git (recommended if the project is in a repo you control):**

```bash
sudo mkdir -p /opt/auction-search
sudo chown deploy:deploy /opt/auction-search
git clone <your-repo-url> /opt/auction-search
```

**Option B — upload from your local machine (no git repo):**

From your local machine (PowerShell or a terminal with `scp`/`rsync`):

```bash
# From the project folder on your PC
scp -r . deploy@<your-vps-ip>:/opt/auction-search
```

(On Windows, `rsync` via WSL or Git Bash works too, and avoids re-uploading
`node_modules` if you exclude it — see below.)

Either way, exclude `node_modules` and `.env` from what you upload; they get
created/installed on the server in the next steps.

## 7. Configure environment variables

```bash
cd /opt/auction-search
cp .env.example .env
nano .env
```

Set at minimum:

```
PORT=3000
NODE_ENV=production
DATABASE_URL=postgres://auction_user:<the SAME password you set in step 4>@localhost:5432/auction_db
SESSION_SECRET=<generate a long random string>
APP_PASSWORD=<the shared login password for your team>
ADMIN_PASSWORD=<a separate password only the administrator should know>
TRUST_PROXY=1
COOKIE_SECURE=false
```

`ADMIN_PASSWORD` is deliberately separate from `APP_PASSWORD`: anyone with the
shared login password can search and upload CSVs, but changing the login
password itself (via the "パスワード変更" button) additionally requires this
admin password. Don't share it with regular users of the system.

Like `APP_PASSWORD`, this value only seeds the database the first time the
server starts - after that, both passwords are managed entirely from the
"パスワード変更" dialog in the app (it has two tabs: one to change the shared
login password, one to change the admin password itself).

There's no in-app recovery if the admin password is forgotten. If that
happens, reset it directly from the VPS:

```bash
cd /opt/auction-search
node -e "
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const newAdminPassword = 'PutYourNewAdminPasswordHere';
bcrypt.hash(newAdminPassword, 10).then(hash =>
  pool.query(\"UPDATE users SET password_hash = \$1 WHERE username = 'admin_secret'\", [hash])
).then(() => { console.log('Admin password reset.'); pool.end(); });
"
```

> ⚠️ `DATABASE_URL`'s password must be the **literal password you chose** when running
> `CREATE USER auction_user WITH PASSWORD '...'` in step 4 — not placeholder text copied
> as-is. If they don't match exactly, `npm run migrate` fails with "password authentication
> failed for user auction_user".
>
> Leave `COOKIE_SECURE=false` for now. It must stay `false` until HTTPS is actually working
> (step 12) — turning it on early makes login appear to succeed but immediately bounce back
> to the login page, because the browser silently refuses to send a Secure cookie over plain
> HTTP.

Generate a strong `SESSION_SECRET` quickly with:

```bash
openssl rand -hex 32
```

## 8. Install dependencies and apply the database schema

```bash
cd /opt/auction-search
npm install --production
npm run migrate
```

This creates the `auction_items` table plus the indexes used for fast
search (`pg_trgm` GIN index on `商品詳細`, B-tree index on `大会`, and a
unique constraint on `(大会, 箱番号, 枝番号)` used to detect duplicates —
see note below).

## 9. Migrate the existing ~100,000 records

Export the current Google Sheets data as CSV (UTF-8 or Shift_JIS/CP932 are
both auto-detected — Excel-saved CSVs on Japanese Windows are commonly
Shift_JIS, and that's handled automatically), with header row:

```
大会,箱番号,枝番号,商品詳細,ランク,金額
```

Column order doesn't matter (columns are matched by header name), and any
extra columns — including an `ID` column, if the export includes one — are
simply ignored. The source data's `ID` is not used as a unique key: duplicate
detection is based on the combination of `大会` + `箱番号` + `枝番号`, so
re-importing a row with the same combination updates it in place instead of
creating a duplicate.

Upload that CSV file to the server, e.g.:

```bash
scp existing_data.csv deploy@<your-vps-ip>:/opt/auction-search/
```

Then run the one-time bulk import (uses PostgreSQL `COPY` for speed —
~100,000 rows takes roughly 20-30 seconds):

```bash
cd /opt/auction-search
npm run import:bulk -- ./existing_data.csv
```

The script prints how many rows were inserted/updated and reports any
invalid rows (bad `大会`, bad `金額`, missing `箱番号`/`枝番号`) without
failing the whole import.

After this, ongoing weekly updates (~3,000 rows/week) are done through the
web upload screen once the app is running — no need to use this CLI script
again unless you're doing another large one-off load.

## 10. Run the app as a systemd service

A ready-made unit file is included at `deploy/auction-search.service`.

```bash
sudo cp deploy/auction-search.service /etc/systemd/system/auction-search.service
sudo systemctl daemon-reload
sudo systemctl enable --now auction-search
sudo systemctl status auction-search
```

Check logs if anything looks wrong:

```bash
sudo journalctl -u auction-search -f
```

Note: the unit file runs the app as the `deploy` user (the same one you created
in step 2) and reads `/opt/auction-search/.env`. If you deployed to a different
path or used a different admin username, edit `User`, `WorkingDirectory`, and
`EnvironmentFile` in the unit file accordingly.

Running it as `deploy` (rather than `www-data`) is deliberate: it keeps the
app directory's ownership matching whoever actually maintains it day to day
(`git pull`, editing `.env`, etc.), instead of creating an ownership mismatch
that later blocks `git pull` with a "dubious ownership" error or permission
denied errors when editing files. No `chown` is needed here — the directory
should already be owned by `deploy` from step 6.

> If you'd rather isolate the app under the more conventional `www-data`
> service account instead, that's fine too — just remember that afterwards
> `git pull` and file edits as `deploy` will need either
> `sudo chown -R deploy:deploy /opt/auction-search` run first, or `sudo -u
> www-data git pull` / doing maintenance as `www-data` instead.

(If you'd rather run the service as the `deploy` user instead of `www-data`,
change `User=www-data` in the unit file and skip the `chown` above.)

## 11. Configure Nginx as a reverse proxy

A ready-made config is included at `deploy/nginx.conf`.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/auction-search
sudo nano /etc/nginx/sites-available/auction-search   # set server_name to your domain or the VPS IP
sudo ln -s /etc/nginx/sites-available/auction-search /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

At this point the app should be reachable at `http://<your-domain-or-ip>/`.

## 12. Enable HTTPS (recommended)

If you have a domain pointed at the VPS's IP address:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example.com
```

Certbot edits the Nginx config to add a `listen 443 ssl;` block and sets up
auto-renewal. Without a domain (IP-only access), you can skip this, but be
aware traffic (including the login password) won't be encrypted — fine for
quick testing, not recommended for real use.

**Once HTTPS is confirmed working**, flip the session cookie back to secure mode:

```bash
nano .env   # set COOKIE_SECURE=true
sudo systemctl restart auction-search
```

Skip this while you're still on IP-only HTTP — leave `COOKIE_SECURE=false` until
this step is actually done, or login will silently break (see step 7's note).

## 13. Verify everything works

```bash
curl -I http://localhost:3000/healthz   # should return HTTP/1.1 200 OK, from the server itself
```

From a browser: open `https://your-domain.example.com/`, you should land on
the login page. Log in with `APP_PASSWORD`, then try a search and a small
CSV upload to confirm the whole pipeline works end to end.

## 14. Ongoing weekly data updates

No server access needed for this — once deployed, whoever manages the data
just logs into the web UI and uses the **"CSV Upload (Update DB)"** panel
to upload the week's new CSV. Records are matched/deduplicated by `ID`
automatically (existing IDs are updated, new IDs are inserted).

## 15. Basic operations

Restart the app after a code update:

```bash
cd /opt/auction-search
git pull            # or re-upload files
npm install --production
sudo systemctl restart auction-search
```

Back up the database:

```bash
pg_dump -U auction_user -h localhost auction_db > backup_$(date +%Y%m%d).sql
```

Check disk usage / table size as data grows:

```bash
sudo -u postgres psql -d auction_db -c "\dt+ auction_items"
```
