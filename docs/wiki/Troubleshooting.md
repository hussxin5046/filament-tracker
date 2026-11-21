# Troubleshooting

Common problems and what to do about them. Problems with connected printers and the bridge have their own table in the [Bridge reference](Bridge-reference.md#when-something-is-wrong), and so do [location displays](Location-displays.md#troubleshooting).

## Using Wrkbench

| What you see | What to do |
| --- | --- |
| A button you expect is missing, or a change is refused | Your role may not allow it. See [Members and roles](Members-and-roles.md) and ask an owner to change your role |
| "No account uses that email yet" when adding a member | The person must sign up with that email address before an owner can add them |
| "You are the only owner" when leaving a workspace or deleting your account | Make another member an owner first, or delete the workspace |
| "Too many sign-in attempts for this email" | Someone, maybe you, typed the wrong password for this email 10 times in 15 minutes. Wait up to 15 minutes, or use **Forgot password?** to choose a new password, which lets you straight back in |
| A requester is told "This workshop cannot take files at the moment" | The workspace's request files have reached their allowance, or the server's disk is nearly full. Delete job requests you no longer need. If that does not help, tell whoever runs your copy of Wrkbench |
| "Confirm your email address" stays at the top of the page | Open the link in the email Wrkbench sent when you registered. It works for a day; **Send the link again** sends a new one. The notice goes when you come back to the page |
| "This link has expired or is not for this account" | The confirmation link is more than a day old. Sign in and press **Send the link again** |
| "That account has not confirmed its email address yet" when adding a member | The person has to open their confirmation link first. See [Members and roles](Members-and-roles.md#add-someone) |
| "That code is not right" when signing in with two-step sign-in | Use the newest code in your authenticator app: they change every 30 seconds, and one that was already used is refused. If every code is refused, your phone's clock is probably wrong: set it to automatic time |
| "Too many wrong codes" | Five wrong codes in 15 minutes pause the second step for that account. Wait up to 15 minutes |
| You lost your phone | On the code step, press **Lost your phone? Use a recovery code** and enter one of the recovery codes you saved. See [Two-step sign-in](Getting-started.md#two-step-sign-in) |
| You lost your phone and your recovery codes | Ask whoever runs your copy of Wrkbench to turn two-step sign-in off for your account. They will want to be sure it is you. Then sign in with your password and turn it on again |
| "Use at least 12 characters" when setting a password | New passwords need 12 characters or more. A few unrelated words are an easy way to get there. No symbols or capitals are needed. See [Choosing a password](Getting-started.md#choosing-a-password) |
| "This is a commonly used password" or "This repeats the same few characters" | The password is one that people trying to break in guess first. Choose something of your own |
| "Do not make your password from your name, your email address or the word Wrkbench" | Those are the first things someone who knows you would try. Choose something else |
| "This password has appeared in a data leak" | That exact password was among those stolen from some website, not necessarily from you, and such passwords are tried everywhere. Choose a different one. If you use it elsewhere, change it there too |
| You could sign in with a short password, but cannot set one | Passwords set before the rules changed keep working. The rules apply only when you choose a new one |
| The password reset email never arrives | Check your spam folder. If it is not there, whoever runs your copy of Wrkbench has not set up email yet |
| A requester lost their progress link | Find the request under **Jobs**, **Requests**, press **Copy progress link** and send it to them again |
| The request form says "Attach at least one file" | Every request needs at least one file for the workshop to check |
| The daily report did not open today | It only opens once per person, workspace and day on each device. Use **Daily report** in the sidebar |
| A maintenance task shows as due straight away | Log the last service you actually did with **Done**, so the clock starts from then. See [Maintenance](Maintenance.md#when-a-task-is-due) |
| Stock went down by mistake | An admin can press **Undo** on the change under **Activity** |
| The app looks out of date after an update | Reload the page. Wrkbench installs as an app and refreshes itself, but an open tab can hold the old version until reloaded |

## Running your own copy

| What you see | Likely cause and what to do |
| --- | --- |
| The server stops at start with "Invalid environment" | A setting is missing or wrong; the lines below the message name it. Most often `JWT_SECRET` (missing or under 16 characters) or `DATABASE_URL`. See [Self-hosting](Self-hosting.md#settings) |
| `PRINTERS_ENABLED` or `DEVICES_ENABLED` is named in that error | It must be exactly `true` or `false`, not `0`, `1`, `yes` or `no` |
| Links in emails, or the bridge set-up command, point at `localhost:5173` | `CLIENT_ORIGIN` (or `APP_URL`) is not set to your site's real address |
| Emails only appear in the server log | Neither `RESEND_API_KEY` nor `SMTP_URL` is set. See [Self-hosting](Self-hosting.md#email) |
| Emails are rejected by the provider | `MAIL_FROM` must be an address on a domain your mail provider has verified |
| Everything is gone after a redeploy | The data folder is not on a persistent volume. With Docker, mount one at `/data` |
| Everyone gets "Too many requests from this connection" at once | `TRUST_PROXY` does not match the number of proxies in front of the app, so all visitors look like one. Usually it should be `1` |
| Live updates or printer bridges do not connect | The proxy in front of the app is not passing WebSocket connections |
| `npm run build` fails on a test | The build runs the server tests on purpose. Run `npm test -w server` to see which one fails |
| `npm run dev` says the port is in use | Another copy is already running on port 4000 or 5173. Stop it, or see [CONTRIBUTING.md](../../CONTRIBUTING.md#running-two-copies) |

Still stuck? [Open an issue](https://github.com/hussxin5046/filament-tracker/issues/new/choose) and say what you did, what you expected and what happened instead. For security problems, follow [SECURITY.md](../../SECURITY.md) instead of opening an issue.
