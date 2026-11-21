# Contributing to Wrkbench

Thanks for helping. Bug reports, ideas, documentation fixes and code are all welcome.

- **Bugs and ideas**: [open an issue](https://github.com/hussxin5046/filament-tracker/issues/new/choose). Check the existing issues first.
- **Security problems**: do not open an issue. Follow [SECURITY.md](SECURITY.md).
- **Code and docs**: open a pull request. For anything bigger than a small fix, open an issue first so we can agree on the approach.

By contributing, you agree that your contribution is licensed under the [AGPL-3.0](LICENSE), like the rest of the project.

## Set up a development copy

Follow [Try it on your computer](README.md#try-it-on-your-computer) in the README. In short: Node.js 22.9 or newer, copy `server/.env.example` to `server/.env`, set `JWT_SECRET` and `SEED_PASSWORD`, then `npm run setup` and `npm run dev`.

`npm run dev` starts two things: the API on <http://localhost:4000> and the web app on <http://localhost:5173>, which forwards API calls to the first. Both reload when you save a file.

## Commands

Run these from the root of the repository.

| Command | What it does |
| --- | --- |
| `npm run setup` | Install dependencies, create the database and add the demo data |
| `npm run dev` | Run the API and web app with live reload |
| `npm test` | Run all tests (server, client, bridge) |
| `npm test -w server` | Run one package's tests. Also `-w client`, `-w bridge` |
| `npm run typecheck` | Type-check every package |
| `npm run build` | Build for production. **This also type-checks and runs the server tests** |
| `npm start` | Run the production build |
| `npm run db:migrate` | Apply schema changes in development, creating a migration if the schema changed |
| `npm run db:seed` | Add the demo account and example maker space |
| `npm run db:reset` | Wipe the development database and seed it again |
| `npm run db:backup`, `db:backups`, `db:restore -- <name>` | Make, list and put back a backup in the bucket named by the `BACKUP_S3_` settings. See [Self-hosting](docs/wiki/Self-hosting.md#backups) |
| `npm run bridge -- ...` | Run the printer bridge from source. See the [Bridge reference](docs/wiki/Bridge-reference.md) |
| `pio run -d firmware/cyd` | Build the location display firmware (needs [PlatformIO](https://platformio.org/)). See [firmware/README.md](firmware/README.md) |
| `pio run -d firmware/cyd -e cyd-st7789 -t upload` | Build and flash a display plugged in by USB |

There is no linter or formatter set up yet. GitHub type-checks, runs every test and builds the web app on each pull request and on `main` (`.github/workflows/test.yml`). Run `npm test` and `npm run typecheck` yourself before opening a pull request, so the first run is green.

## Where each branch runs

The hosted Wrkbench has two copies, each built from this repository by the host whenever its branch changes:

| Copy | Built from | When it changes |
| --- | --- | --- |
| **Production** | `main` | Every merge into `main` goes live |
| **Staging** | One chosen branch, at the time of writing the location display branch | Every push to that branch |

Each copy has its own database. A new migration is applied when the server starts (`npm run db:deploy`, in the image's start command), so:

- **Merging into `main` is a release.** Try the change on staging first.
- **A migration cannot be taken back by reverting the merge.** The database keeps the new tables and columns. Check a migration on staging before it reaches production. The start command keeps a copy of the database from just before (`npm run db:prepare`, into `pre-migrate/` beside it), which is the way back if one goes wrong.
- **Pushing to the staging branch changes staging's data too**, when the push carries a migration.
- **To try a different piece of work on staging**, point staging at that branch in the host's settings.

The display firmware in `firmware/cyd` is not part of any of this: it is flashed onto a display by hand, and a display keeps working with a newer server.

### Running two copies

To run a second copy next to one already running (for example on another branch), give it other ports:

```bash
PORT=4001 npm run dev -w server
```

```bash
API_PORT=4001 npm run dev -w client -- --port 5174 --strictPort
```

Both copies use the same database file unless you also set `DATABASE_URL`.

## How the code is laid out

This is an npm workspaces monorepo, all TypeScript, with four packages, plus the display firmware:

| Package | What it is |
| --- | --- |
| `server/` | The API: Express, Prisma on SQLite, socket.io for live updates. Also serves the built web app in production |
| `client/` | The web app: React, Vite, CSS Modules. Installable as a PWA |
| `bridge/` | A separate command-line program that reads Bambu Lab printers on a workshop's network and reports to the server |
| `protocol/` | The messages the server and the bridge exchange, shared by both |
| `firmware/` | Firmware for Wrkbench's own hardware: the CYD location display. Built with PlatformIO, not an npm workspace |

Where to find things:

| Path | What lives there |
| --- | --- |
| `server/prisma/schema.prisma` | The data model: generic `ItemType` / `CustomField` / `Item`, machines, attached hardware (`SubUnit`) and slots, maintenance, jobs, the stock audit trail |
| `server/prisma/migrations/` | Database migrations |
| `server/src/env.ts` | Every server setting, with defaults and validation |
| `server/src/db.ts` | The database client. It uses one connection, so changes take turns, and switches SQLite to its write-ahead log when the server starts |
| `server/src/routes/` | The REST API. Everything under `/api/workspaces/:id` is membership- and role-checked |
| `server/src/auth.ts` | Sign-in tokens and role checks (see [Roles](#roles) below) |
| `server/src/services/twoStep.ts` | Two-step sign-in: authenticator codes (RFC 6238), how the secret is stored, recovery codes. The routes are in `server/src/routes/auth.ts`; the host's off switch is `server/scripts/two-step-off.ts` |
| `server/src/services/passwordRules.ts`, `passwords.ts` | What a new password must pass (length, the built-in list of common passwords in `server/data/passwords/common.txt`), and the lookup among leaked passwords. `client/src/lib/passwordRules.ts` shows the same rules while typing: change both together |
| `server/src/services/passkeys.ts`, `passkeySite.ts` | Passkeys: which site address they are tied to, the one-time challenges, the stored credentials and their sign-in counters. The cryptography is `@simplewebauthn/server`'s. The routes are in `server/src/routes/passkeys.ts`; the host's off switch is `server/scripts/passkeys-off.ts`; `server/test/fakeAuthenticator.ts` is a pretend device for tests |
| `server/src/services/attempts.ts` | Counting tries at something that must not be guessed (passwords), per account, in the database so a restart does not reset it |
| `server/src/idempotency.ts` | Idempotency keys: a POST repeated with the same `Idempotency-Key` is answered from memory instead of running twice. The web app sends one with every POST (`client/src/lib/idempotency.ts`) |
| `server/src/services/` | Business logic: stock, jobs and the queue, projects, maintenance, the daily report, the reorder list, spool tags, email, uploads |
| `server/src/services/backup.ts` | Nightly backups to S3-compatible storage and putting one back; `s3.ts` beside it is the small client it uses. `server/scripts/prestart.ts` runs before each start |
| `server/src/services/snapshot.ts` | The portable workspace format behind JSON import and export, templates and the seed |
| `server/src/routes/requests.ts` | Outside job requests: the public routes (the only ones that need no account) and the review queue |
| `server/src/routes/devices.ts` | Location displays: the routes members use to set them up, and the ones a display calls with its own key (`/api/device`) |
| `server/src/integrations/` | Connected printers: reading Bambu Lab status (`bambu/`), the live registry, AMS and spool sync, and where bridges connect |
| `server/src/templates/` | Workspace templates and the example maker space, as data |
| `server/src/reference/` | The built-in catalogue of machines and materials |
| `server/data/reference/filaments.json` | Filament product lines, generated from SpoolmanDB |
| `server/test/` | Server tests (Vitest). Each test file gets its own temporary database |
| `client/src/pages/` | One file per screen |
| `client/src/components/ui/` | Shared components |
| `client/src/styles/tokens.css` | Design tokens (light and dark) |
| `docs/wiki/` | The user guides, published to the GitHub wiki |

## Conventions

- **No inline styles.** Use CSS Modules that reference the design tokens.
- **Imports** use the `@/` alias in both client and server.
- **Icons** are Lucide only. Icons a workspace can pick from are listed in `client/src/lib/icons.ts`.
- **Stock only changes through `moveStock`** (`server/src/services/stock.ts`), so every change leaves an audit row and can be undone.
- **Writing on screen** is plain and short: say what will happen, in the words a workshop uses.

### Roles

Every route under `/api/workspaces/:id` checks the member's role. Operators may only make the writes listed in `OPERATOR_WRITES` in `server/src/auth.ts`, so **a new route that changes data is admin-only until you add it there**. Viewers can never write. The user-facing summary is in [Members and roles](docs/wiki/Members-and-roles.md); update it if you change who can do what.

## The built-in catalogue

Machines, endmills, fasteners, sheet stock and finishes are TypeScript lists in `server/src/reference/`, type-checked against the option lists in `server/src/templates/library.ts`, so a bad value fails the build.

Only add a machine spec you have confirmed on the maker's own website, and leave it out if the maker's figures disagree.

Filament comes from [SpoolmanDB](https://github.com/Donkie/SpoolmanDB) (MIT licence, credited in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)). To refresh it:

```bash
git clone --depth 1 https://github.com/Donkie/SpoolmanDB /tmp/spoolmandb
```

```bash
npm run reference:filaments -w server -- --dir /tmp/spoolmandb
```

The output is sorted, so the diff shows only what changed upstream. Material codes the import cannot place are listed and filed under "Other"; add a rule to `MATERIAL_RULES` in `server/scripts/import-filaments.ts` if one deserves its own entry. `npm test -w server` checks the data.

The built-in list of common passwords comes from [SecLists](https://github.com/danielmiessler/SecLists) (MIT licence, credited in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)). To refresh it:

```bash
git clone --depth 1 https://github.com/danielmiessler/SecLists /tmp/seclists
```

```bash
npm run reference:passwords -w server -- --dir /tmp/seclists
```

It writes the server's list and the web app's copy of it; a server test fails if the two differ.

## Connected printers

Printers are read the way community tools do, not through an official Bambu Lab interface. Parts written without a printer to hand (how some models report trays, dual-nozzle details, discovery) are marked in `server/src/integrations/bambu/normalize.ts` and tested with made-up data in `protocol/src/fixtures.ts`.

To test without hardware, run the bridge with `--simulate`; see [Trying it without a printer](docs/wiki/Bridge-reference.md#trying-it-without-a-printer). To turn guesses into facts, `wrkbench-bridge record` saves what a real printer reports, with serial numbers and addresses replaced, ready to become test data. Recordings from models we have not seen are very welcome.

## Documentation

- The **README** is the front page: what Wrkbench is, the quick start, and links.
- The **user guides** are in [`docs/wiki/`](docs/wiki/Home.md), one task per page. Write for someone who runs a workshop, not a developer: no file paths or code on user pages, bold for anything on screen, numbered steps when order matters. Add new terms to the [Glossary](docs/wiki/Glossary.md).
- Link between wiki pages with relative links that include `.md`, for example `[Inventory](Inventory.md#tool-life)`. Link to files outside the wiki with a relative path such as `../../CONTRIBUTING.md`. Both work on GitHub and in the wiki.
- Screenshots go in `docs/wiki/images/`. Take them from the example maker space (`npm run setup`), never from real workshop data.
- If you add a page, add it to [`Home.md`](docs/wiki/Home.md), [`_Sidebar.md`](docs/wiki/_Sidebar.md) and, if it is a main guide, the README's Guides table.

### How the wiki is published

When changes to `docs/wiki/` reach `main`, the [wiki sync workflow](.github/workflows/wiki-sync.yml) runs `scripts/build-wiki.mjs`, which copies the pages and rewrites their links for the wiki, and pushes the result to the GitHub wiki. Never edit the wiki directly: the next sync overwrites it.

To preview what the wiki will receive:

```bash
node scripts/build-wiki.mjs /tmp/wiki-preview
```

**One-time set-up for the repository owner:** in the repository's **Settings**, **General**, **Features**, turn on **Wikis**. Then open the **Wiki** tab and save any first page, because GitHub only creates the wiki's storage once a page exists. After that the workflow keeps it up to date (it can also be run by hand from the **Actions** tab).
