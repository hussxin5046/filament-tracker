# Getting started

Wrkbench keeps track of what your workshop has in stock, where it is, which machines it fits, and what needs doing next. This page takes you from signing in to a workspace you can use.

## Sign in or try it as a guest

![The sign-in page](images/sign-in.png)

- **Create an account** with your name, email and a password. See [Choosing a password](#choosing-a-password) for what makes one acceptable.
- **Confirm your email.** After you create an account, Wrkbench emails you a link. Open it within a day to show the address is yours. If it is not in your inbox, look in your junk folder. You can use Wrkbench straight away without it, but until you do, nobody can add you to their workspace, and a notice at the top of the page reminds you. **Send the link again** on that notice sends a fresh one. (If whoever runs your copy of Wrkbench has not set up email, there is nothing to confirm and no notice.)
- **Continue as guest** to look around without registering. You get your own copy of the example maker space, full of sample machines, stock and jobs. If you like it, choose **Create an account** in the sidebar and everything you set up as a guest moves to your new account. A guest that is not turned into an account is deleted after 7 days.
- **Forgot password?** emails you a link that works once, for one hour. (The person running your copy of Wrkbench has to have set up email for this to arrive.) Choosing a new password this way also confirms your email.
- Whenever your password changes, Wrkbench emails you to say so. If you did not change it, use **Forgot password?** at once to choose a new one.
- After 10 wrong passwords for one email within 15 minutes, signing in with that email is paused for up to 15 minutes, from any device. Choosing a new password with **Forgot password?** lifts the pause straight away.

## Choosing a password

These rules apply whenever you set a password: when you **Create an account**, under **Change password**, and when you choose a new one from a **Forgot password?** link.

- **At least 12 characters.** Length is what makes a password hard to guess. A few unrelated words work well, spaces included.
- **No symbols, capitals or numbers are required.** Use them if you like. A password from a password manager is fine.
- **At most 72 characters.** Accented letters and emoji take up more room, so a password full of them has a lower limit.

Wrkbench refuses a password that would be easy to guess, and says why:

- one that many people use, such as **qwerty123456**;
- the same few characters repeated, such as **abcabcabcabc**;
- your email address, or just your name or the word Wrkbench with numbers around it;
- one that has appeared in a data leak. Passwords stolen from other websites are collected and tried everywhere, so one that has leaked is not safe even if it is long.

The line under the password box tells you how you are doing as you type. The check for leaked passwords happens when you press the button.

To check for leaks, Wrkbench asks a public service, Have I Been Pwned. Your password is never sent to it, only a small part of a scrambled form of it, which is not enough to work out the password. Whoever runs your copy of Wrkbench can turn this check off.

**A password you already have keeps working**, even if it is shorter than 12 characters. The rules apply the next time you change it.

## Passkeys

A passkey lets you sign in with your fingerprint, your face or your device's screen lock, without typing your password. It is kept by your phone, computer or security key, and it only works on your copy of Wrkbench, so it cannot be tricked out of you by a fake sign-in page.

Your password keeps working alongside it. If you lose the device, sign in with your password as before.

**Add one**

1. Go to **Settings**, **Your account**, and press **Add a passkey**.
2. Enter your password and press **Continue**. If you use [two-step sign-in](#two-step-sign-in), enter a code as well.
3. Your device asks for your fingerprint, face or screen lock. Follow what it shows.
4. Give the passkey a name you will recognise, such as **Bench laptop**, and press **Done**.

Wrkbench emails you whenever a passkey is added or removed. You can have up to 10. You must have [confirmed your email](#sign-in-or-try-it-as-a-guest) first, and a guest session cannot have one.

**Sign in with it.** On the sign-in page press **Sign in with a passkey** and follow what your device shows. You do not need to type your email. A passkey counts as both steps of two-step sign-in, so you are not asked for a code.

**Rename or remove one** under **Settings**, **Your account**, where each passkey shows when it was added and last used. Removing one stops it signing in at once; you can remove the last one. Your device may keep listing it until you delete it there too.

Good to know:

- A passkey saved to your Apple, Google or Microsoft account, or to a password manager, follows you to your other devices. One saved to a single device or a security key stays there, so add a passkey on each device you use.
- Choosing a new password with **Forgot password?** does not remove your passkeys.
- If you lose a device, remove its passkey under **Settings**, **Your account** from another device. If you cannot get in at all, see [Troubleshooting](Troubleshooting.md).

## Two-step sign-in

Two-step sign-in asks for a code from an app on your phone as well as your password, so a password that leaks is not enough to get into your account. It is off until you turn it on, and it is yours alone: it does not change anything for other members.

You need an authenticator app, such as Google Authenticator, Microsoft Authenticator, 1Password or Aegis.

**Turn it on**

1. Go to **Settings**, **Your account**, and press **Turn on two-step sign-in**.
2. Enter your password and press **Continue**.
3. In your authenticator app, add an account and scan the code on screen. If you cannot scan it, type the key shown under it into the app.
4. Enter the **6-digit code** the app shows and press **Turn on**.
5. Wrkbench shows ten **recovery codes**. **Copy** or **Download** them and keep them somewhere safe, away from your phone. They are shown only this once.

Your other devices are signed out when you turn it on. You must have [confirmed your email](#sign-in-or-try-it-as-a-guest) first.

**Signing in** then has a second step: after your password, enter the code your app shows for Wrkbench. Codes change every 30 seconds and each works once.

**If you lose your phone**, press **Lost your phone? Use a recovery code** on that second step and enter one of your recovery codes. Each works once, and Wrkbench emails you whenever one is used. Then go to **Settings**, **Your account** to turn two-step sign-in off and on again with your new phone.

Under **Settings**, **Your account** you can also see how many recovery codes are left, make a fresh set with **New recovery codes** (the old ones stop working), or **Turn off** two-step sign-in. Each asks for your password and a code.

**Forgot password?** still works, but the new password does not sign you in by itself: you are asked for a code as usual.

If you have lost both your phone and your recovery codes, only the person who runs your copy of Wrkbench can let you back in. See [Troubleshooting](Troubleshooting.md).

## Create a workspace

A **workspace** is one workshop: its stock, machines, jobs and members. You can belong to several and switch between them with the **Workspace** menu at the top of the sidebar.

![Creating a new workspace from a template](images/new-workspace.png)

Setting up a workspace is a few short steps, with **Next** and **Back** to move between them.

1. **Workspace**: give it a name and a **Currency** (a 3-letter code such as GBP, EUR or USD, used for costs).
2. **Start from**: pick the template closest to your workshop:

   | Template | Starts you with |
   | --- | --- |
   | Blank | Nothing. You add your own categories, units and machines |
   | 3D printing | Filament by weight, resin, nozzles and spares, printer maintenance schedules |
   | CNC machining | Endmills with tool-life hours, bar and block stock, collet and spindle checks |
   | Laser cutting | Sheet stock with searchable offcuts, optics and extraction filter schedules |
   | Mixed workshop | Printing, CNC, laser and finishing together, with every starter category |
   | School lab | Class kits, safety equipment and shared machines, with a locked store and termly safety checks |
   | Example maker space | A fully filled-in sample with machines, stock and jobs, useful for learning the app |

   Under **Adjust what gets created**, untick anything you do not need.
3. **Your machines** (optional, **Skip for now** if you like): pick the machines you own from the built-in catalogue. Each one arrives with its specs, its feeders or tool changers, and its maintenance schedules.
4. **Make it yours** (your first workspace only): pick light or dark mode, a palette and an accent colour. It is saved to your account as you choose; change it later under [Settings, Appearance](Catalogue-and-settings.md#appearance).
5. Press **Create workspace**.

A template only fills things in for you. Everything stays editable afterwards.

## Find your way around

The sidebar has one entry per screen. On a phone, four of them sit in a bar at the bottom and the rest are under **More**. You can change the order, hide pages you do not use, and choose which four go in the phone bar, under [Settings, Navigation](Catalogue-and-settings.md#navigation).

| Screen | What it is for | Guide |
| --- | --- | --- |
| **Overview** | What needs attention before the next job | [Dashboard and reports](Dashboard-and-reports.md) |
| **Inventory** | Everything you stock, and how much is left | [Inventory](Inventory.md) |
| **Locations** | Where things are kept, what is in each place, and putting things away | [Locations](Locations.md) |
| **Jobs** | Work to be done, the queue per machine, and requests from outside | [Jobs and the queue](Jobs-and-queue.md), [Job requests](Job-requests.md) |
| **Maintenance** | Recurring servicing, by date or by hours of use | [Maintenance](Maintenance.md) |
| **Machines** | Your equipment and what is loaded in it | [Machines](Machines.md) |
| **Reorder** | What to buy, grouped by supplier | [Inventory](Inventory.md#reordering) |
| **Activity** | Every change, who made it, and undo for stock mistakes | [Dashboard and reports](Dashboard-and-reports.md#activity) |
| **Settings** | Categories, units, suppliers, members, printers, import and export; and your own appearance, menu order and account | [Catalogue and settings](Catalogue-and-settings.md) |

A red number on a sidebar entry counts things waiting there: overdue maintenance, items to reorder, requests to check.

On a phone, anything that opens over the screen (an item, a form, **More**) slides up from the bottom. To close it, drag the bar at its top downwards and let go, flick it down, or press the **X**.

### Search

**Search**, at the top of the sidebar (the magnifying glass at the top of the screen on a phone), finds any page, any section of Settings, any item in your inventory and a few everyday actions such as **Scan a label** or **Sign out**. Type a few letters, move through the results with the up and down arrow keys, and press **Enter** to open the one that is highlighted.

With a keyboard, **Ctrl K** opens it from anywhere (**⌘K** on a Mac), and pressing it again or **Esc** closes it. The shortcut is shown next to **Search** in the sidebar. It works while you are typing in a field, but not while another dialog is open.

### Whole workshop or one machine

The **Whole workshop** button at the top right of most screens lets you pick a single machine. While one is picked, Overview becomes that machine's own page, and Inventory, Jobs, Maintenance and Reorder only show what concerns it. Pick **Whole workshop** again to go back. This is called **machine focus**, and Wrkbench remembers your choice on each device.

## Next steps

- Add the things you stock: [Inventory](Inventory.md).
- Invite the people you work with: [Members and roles](Members-and-roles.md).
- Bring in what you already track in a spreadsheet: [Backups, import and export](Backups-and-data.md).
- If you have Bambu Lab printers, connect them: [Connecting printers](Connecting-printers.md).
