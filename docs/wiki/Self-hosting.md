# Self-hosting

How to run your own copy of Wrkbench for your workshop. If you only want to try it on your own computer, the quick start in the [README](../../README.md#try-it-on-your-computer) is enough.

## What you are running

Wrkbench is a single Node.js program. It serves the web app, its API and live updates on one port, and keeps everything in two places:

- a **SQLite database file** (no separate database server is needed), with two small files SQLite keeps beside it while the app runs (the same name ending in `-wal` and `-shm`), and
- an **uploads folder** for files sent with [job requests](Job-requests.md).

So the host needs:

- **A persistent disk** for those two. Without one, every redeploy starts from empty.
- **Exactly one running copy.** Rate limits, live updates and connected printers are held in the program's memory, so two copies behind a load balancer would not see each other.
- **HTTPS in front of it**, from your host or a reverse proxy such as Caddy or nginx. The proxy must pass WebSocket connections, which live updates and printer bridges use.

## Option 1: Docker (recommended)

The `Dockerfile` at the root of the repository builds the whole app into one image. The image keeps everything under `/data`: the database is `/data/app.db` and uploads go to `/data/uploads`. Mount a persistent volume there.

```bash
docker build -t wrkbench .
```

```bash
docker run -d --name wrkbench --restart unless-stopped \
  -p 4000:4000 -v wrkbench-data:/data \
  -e JWT_SECRET="<a long random string>" \
  -e CLIENT_ORIGIN="https://wrkbench.example.com" \
  wrkbench
```

Each time it starts, the container applies any pending database changes and then starts the app. If there are any, it first [keeps a copy of the database as it was](#a-copy-before-every-update). To update: pull the new code, build again, and replace the container. The volume keeps your data.

Building the image also type-checks the code and runs the server's tests, so a broken change fails the build instead of reaching your site.

Any host that runs a Docker image with a persistent volume works: a VPS, a home server, or a platform such as Railway, Fly.io or Render. On a platform, set the variables below in its dashboard and attach a volume at `/data`.

## Option 2: Node.js without Docker

You need Node.js 22.9 or newer.

```bash
npm ci
```

```bash
npm run build
```

```bash
npm run db:deploy
```

```bash
npm start
```

When you update later, run `npm run db:prepare` before `npm run db:deploy`. It [keeps a copy of the database](#a-copy-before-every-update) if the update is about to change it.

Set the variables below in the environment, or in a `server/.env` file (read when present). Run `npm ci` without `NODE_ENV=production`, because the build needs the development tools. Keep the app running with whatever you use for services, such as systemd or pm2.

Without Docker, set `DATABASE_URL` yourself (for example `file:/var/lib/wrkbench/app.db`) and an absolute `UPLOAD_DIR`. A relative upload folder is taken from inside `server/`.

**Do not run `npm run db:seed` on a live site.** It creates a demo account with the password from `server/.env`.

## Settings

All settings are environment variables. The server checks them when it starts, and refuses to start with a message naming any that are wrong.

### Required

| Variable | What to set |
| --- | --- |
| `JWT_SECRET` | A long random string, at least 16 characters, used to sign people in. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never reuse the one from your own computer. Changing it signs everyone out, and stops the authenticator codes of members who use [two-step sign-in](#two-step-sign-in) |
| `DATABASE_URL` | Where the database file is, for example `file:/data/app.db`. The Docker image sets this |

### Your site's address

| Variable | Default | What it does |
| --- | --- | --- |
| `CLIENT_ORIGIN` | `http://localhost:5173` | The address people open Wrkbench at, for example `https://wrkbench.example.com`. **Set this on every live site** |
| `APP_URL` | same as `CLIENT_ORIGIN` | The address used in links in emails and in the printer bridge set-up command, if it differs from `CLIENT_ORIGIN` |
| `PORT` | `4000` | The port the app listens on. Change it only if your host tells you to |
| `TRUST_PROXY` | `0` (Docker image: `1`) | How many proxies sit in front of the app. Usually `1` behind a host or reverse proxy, `0` when reached directly. If this is wrong, every visitor shares one rate limit |

### Email

Without email, password-reset links and job request updates are only printed to the server's log. To send them, set **one** of these, and `MAIL_FROM`:

| Variable | What it does |
| --- | --- |
| `RESEND_API_KEY` | Sends through [Resend](https://resend.com) over HTTPS. Use this on hosts that block outgoing mail ports. Wins if both are set |
| `SMTP_URL` | Sends through any mail server, for example `smtps://user:password@smtp.example.com:465` |
| `MAIL_FROM` | Who emails come from, for example `Workshop <workshop@example.com>`. It must be an address on a domain your mail provider has verified. Default `Wrkbench <no-reply@localhost>` |

With email set up, a new account is also sent a link to confirm its address, and cannot be added to someone else's workspace until it is opened. Accounts that existed before count as confirmed.

| Variable | Default | What it does |
| --- | --- | --- |
| `EMAIL_CONFIRMATION` | `auto` | `auto` asks new accounts to confirm their address when email is set up, and not otherwise. `on` always asks (the link is then only in the log if email is not set up). `off` never asks |

### Passwords

New passwords must have at least 12 characters and must not be common ones; members can read the rules under [Choosing a password](Getting-started.md#choosing-a-password). Passwords that members already have keep working.

Each new password is also looked up among passwords known from data leaks, using the range lookup of [Have I Been Pwned](https://haveibeenpwned.com/Passwords). Your server sends the first five characters of the password's SHA-1 hash to `api.pwnedpasswords.com` and compares the answers itself, so neither the password nor its full hash leaves your server, and nothing about the member is sent. If the service does not answer within three seconds, the password is accepted on the built-in rules alone, the log says the lookup was skipped, and it is not tried again for five minutes.

| Variable | Default | What it does |
| --- | --- | --- |
| `PASSWORD_BREACH_CHECK` | `on` | `on` looks new passwords up as described above. `off` makes no outside call: new passwords are checked against the built-in list of common passwords only. Use `off` on a server with no way out to the internet |

### Two-step sign-in

Members can turn on [two-step sign-in](Getting-started.md#two-step-sign-in) for their own account. There is nothing to set up. Two things to know when you run the server:

- **A member who has lost their phone and their recovery codes** cannot get back in by themselves, and a password reset does not help them. Once you are sure it is them, turn it off for their account. Every device signed in to it is signed out and the account is emailed:

  ```bash
  npm run account:two-step-off -- someone@example.com
  ```

- **Changing `JWT_SECRET`** also stops every member's authenticator codes from working, because the app's secret is stored locked with a key made from it. Their recovery codes still work. After such a change, expect to run the command above for members who have none left.

### Uploads from job requests

| Variable | Default | What it does |
| --- | --- | --- |
| `UPLOAD_DIR` | `uploads` (Docker image: `/data/uploads`) | Where uploaded files are kept |
| `UPLOAD_MAX_MB` | `50` | Largest file, in MB (up to 2048). Keep it small enough that requests cannot fill your disk |
| `UPLOAD_MAX_FILES` | `5` | Most files per request (up to 50) |
| `UPLOAD_EXTENSIONS` | `3mf,stl,step,stp,obj,amf,gcode,nc,svg,dxf,pdf,png,jpg,jpeg,txt` | File types accepted, comma separated |
| `UPLOAD_MAX_WORKSPACE_MB` | `500` | The most one workspace's request files may take up together, in MB. A request that would pass it is refused |
| `UPLOAD_MIN_FREE_MB` | `100` | Uploads are refused while the disk has less than this free, in MB, so the database always has room to write. `0` never refuses |
| `UPLOAD_KEEP_DAYS` | `90` | The files of a request that was rejected or finished are deleted this many days later. `0` keeps them for ever |

Once a day the app removes those old files and looks at the disk. When less than twice `UPLOAD_MIN_FREE_MB` is free it says so in the log, and emails `ALERT_EMAIL` if that is set. Files already saved by a [nightly backup](#nightly-backups-to-a-bucket) stay in the bucket.

### Connected printers

| Variable | Default | What it does |
| --- | --- | --- |
| `PRINTERS_ENABLED` | `true` | `false` hides connected printers and refuses bridges. Must be exactly `true` or `false` |
| `BRIDGE_MAX_PER_WORKSPACE` | `3` | Most bridges per workspace |
| `PRINTER_MAX_PER_BRIDGE` | `20` | Most printers per bridge |
| `BRIDGE_IMAGE` | `ghcr.io/hussxin5046/wrkbench-bridge:latest` | The bridge image named in the set-up command. See [Running a fork](#running-a-fork) |

### Location displays

| Variable | Default | What it does |
| --- | --- | --- |
| `DEVICES_ENABLED` | `true` | `false` refuses [location displays](Location-displays.md). Must be exactly `true` or `false` |
| `DEVICE_MAX_PER_WORKSPACE` | `5` | Most displays per workspace |

A display is told the server's address from `APP_URL` (or `CLIENT_ORIGIN`). On a local network set it to an address other devices reach, such as `http://192.168.1.20:4000`, not `localhost`.

## Backups

The database and uploads together are the only things to back up. With Docker, that is the volume mounted at `/data`. A copy on the same disk, or with the same host, is lost along with them, so keep one somewhere else.

### Nightly backups to a bucket

Wrkbench can do this by itself. Give it a bucket at any S3-compatible storage service (Cloudflare R2, Backblaze B2, Amazon S3, your own MinIO) and it saves:

- **a copy of the whole database** once a day, compressed, and
- **every uploaded file**, once, the first night after it arrives.

Set these and restart. Create an access key that can read, write and delete in that one bucket only.

| Variable | Default | What it does |
| --- | --- | --- |
| `BACKUP_S3_ENDPOINT` | | The storage service's address, without the bucket name. For example `https://<account id>.r2.cloudflarestorage.com` or `https://s3.us-west-004.backblazeb2.com` |
| `BACKUP_S3_BUCKET` | | The bucket's name |
| `BACKUP_S3_ACCESS_KEY_ID` | | The access key's id |
| `BACKUP_S3_SECRET_ACCESS_KEY` | | The access key's secret |
| `BACKUP_S3_REGION` | `auto` | `auto` suits Cloudflare R2. Backblaze B2 and Amazon S3 need theirs, such as `us-west-004` or `eu-west-2` |
| `BACKUP_KEEP_DAILY` | `7` | Database copies kept: the newest from each of this many days |
| `BACKUP_KEEP_WEEKLY` | `4` | And the newest from each of this many weeks |
| `ALERT_EMAIL` | | Who is emailed when a backup fails. Needs [email](#email) set up |

The first four go together: set all of them or none. With none, there are no backups and the log says so when the app starts.

The app looks once an hour and makes a backup when the newest copy in the bucket is a day old, so a restart neither skips a night nor makes an extra copy. Each one is written to the log as `Backup db/<time>.db.gz saved`. A backup that fails is tried again the next hour.

Uploaded files are never removed from the bucket, even after they are deleted in Wrkbench. That way a server that comes back with an empty disk cannot empty the backup too. Delete them at the storage service if you need them gone.

The copies are as private as the bucket is. They hold everything in the database, so keep the bucket private and its key to yourself.

To make a backup now, or to see what is in the bucket:

```bash
npm run db:backup
```

```bash
npm run db:backups
```

### Putting a backup back

**On a platform, or with Docker:** set `RESTORE_BACKUP` to `latest`, or to a name from `npm run db:backups` such as `2026-11-20T03-00-00Z`, and restart. Before the app starts, it fetches that copy, checks it opens as a database, moves the database that was there into `/data/pre-restore/`, puts the copy in its place and fetches any uploaded file that is missing. Then **remove the setting**. A value is only acted on once, so a restart with it still set does nothing, but a setting left behind is a trap for later.

**With Node.js:** stop the app, then:

```bash
npm run db:restore -- latest
```

```bash
npm run db:deploy
```

A restore that cannot finish (no such copy, a damaged copy, wrong keys) changes nothing, and on a platform the app does not start, so it cannot come up on the wrong data. The log says why.

Try a restore once before you need one, on a spare copy of the site.

### A copy before every update

An update that changes the database cannot be undone by going back to the older code. So each time the app starts and finds such a change waiting, it first keeps the database as it was in `/data/pre-migrate/`, named after the time and the change. The last two are kept. To go back: stop the app, put that file in place of `app.db`, and start the older version.

The Docker image does this by itself. With Node.js, run it before `npm run db:deploy` when you update:

```bash
npm run db:prepare
```

### Other ways

Scheduled volume backups, if your host offers them, work too. If you copy the folder yourself, copy the database while the app is stopped, or use SQLite's own backup command, so the copy is not caught half-written. The newest changes can be in the `-wal` file, so a copy of the main file alone, taken while the app runs, can be missing them.

Members can also export each workspace themselves. See [Backups, import and export](Backups-and-data.md).

## Running a fork

Wrkbench is licensed under the AGPL-3.0. If you change it and let other people use your changed copy over a network, you must offer them its source code. If you run a fork:

- **Source link and contact details.** The privacy, terms and notices pages are in `client/src/pages/LegalPages.tsx`. Change `SOURCE_URL` to your fork, `LEGAL_CONTACT` to your own address, and review the privacy and terms text, which describes the original operator.
- **The bridge image.** The default `BRIDGE_IMAGE` is the upstream image. If you change the bridge or the shared protocol, publish your own image (below) and set `BRIDGE_IMAGE` to it.

### Publishing the bridge image

The workflow in `.github/workflows/bridge-image.yml` builds the bridge for 64-bit PCs, 64-bit Raspberry Pi and 32-bit Raspberry Pi, and publishes it to the GitHub Container Registry as `ghcr.io/<your account>/wrkbench-bridge`. It runs when the bridge changes on `main`, when a tag such as `bridge-v0.1.0` is pushed, or by hand.

GitHub makes a new package private. Set it to public once (your profile, **Packages**, `wrkbench-bridge`, **Package settings**, **Change visibility**), or bridges are refused with "denied" when they pull it.

To build it yourself instead, from the root of the repository:

```bash
docker build -f bridge/Dockerfile -t wrkbench-bridge .
```

## Problems

See [Troubleshooting](Troubleshooting.md).
