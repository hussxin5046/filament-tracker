# Wrkbench wiki

Wrkbench keeps track of a workshop's stock, machines, maintenance and jobs. These guides explain how to use it, one task per page, in plain language.

New here? Start with **[Getting started](Getting-started.md)**.

## Using Wrkbench

| Page | What it covers |
| --- | --- |
| [Getting started](Getting-started.md) | Signing in, guest sessions, creating a workspace, finding your way around |
| [Inventory](Inventory.md) | Adding items, changing stock, offcuts, tool life, reordering |
| [Locations](Locations.md) | Rooms, shelves and bins: what is in each, putting things away |
| [Labels and scanning](Labels-and-scanning.md) | Printing QR labels for items and locations, scanning them with a phone or inside Wrkbench |
| [Machines](Machines.md) | Machines, attached hardware and slots, a machine's own page |
| [Maintenance](Maintenance.md) | Recurring servicing by date or hours, logging a service |
| [Jobs and the queue](Jobs-and-queue.md) | Creating and finishing jobs, costs, the order jobs run in |
| [Job requests](Job-requests.md) | Letting people outside the workshop ask for jobs |
| [Dashboard and reports](Dashboard-and-reports.md) | Overview, the daily report, the activity log and undo |
| [Members and roles](Members-and-roles.md) | Sharing a workspace and who can do what |
| [Catalogue and settings](Catalogue-and-settings.md) | Categories, units, suppliers, the built-in catalogue, appearance, menu order, your account |
| [Backups, import and export](Backups-and-data.md) | Exporting a workspace, importing from a spreadsheet |

## Connected printers

| Page | What it covers |
| --- | --- |
| [Connecting printers](Connecting-printers.md) | Step by step: add a bridge, connect a Bambu Lab printer, check it works |
| [AMS and spools](AMS-and-spools.md) | What appears once a printer is connected, and how spools get linked to stock |
| [Spool tags (OpenSpool)](Spool-tags.md) | NFC stickers that open a spool when tapped, and "scan, then insert" for spools the printer cannot identify |
| [Prints and filament use](Prints-and-filament-use.md) | How prints become jobs and how the filament they use is taken from stock |
| [Bridge reference](Bridge-reference.md) | Running, updating and moving the bridge; commands; what to do when something is wrong |

## Running your own copy

| Page | What it covers |
| --- | --- |
| [Self-hosting](Self-hosting.md) | Deploying with Docker or Node.js, every setting, email, backups, running a fork |
| [Troubleshooting](Troubleshooting.md) | Common problems for users and for people hosting Wrkbench |

## Also useful

- [Glossary](Glossary.md): what the words used in Wrkbench mean.
- [Contributing](../../CONTRIBUTING.md): working on the code, and improving these pages.

## How these pages are written

- **Bold** is something on screen: a button, a tab, a field.
- "Admin" means a member with the admin or owner role. Operators and viewers are named when a step is open to them.
- Steps are numbered when the order matters.

These pages live in the [`docs/wiki`](https://github.com/hussxin5046/filament-tracker/tree/main/docs/wiki) folder of the repository and are copied to the GitHub wiki automatically. To suggest a change, edit them there.
