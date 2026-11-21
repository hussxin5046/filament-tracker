import { z } from 'zod';
import { passkeySiteFrom } from '@/services/passkeySite';

/** A host's settings page often leaves a cleared variable behind as an empty string: that counts as not set. */
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  // How many proxies sit in front of the app (1 on most hosts, 0 when it is reached directly).
  // Rate limits count per client address, which is only right when this matches.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  // Files sent with outside job requests. The folder is relative to the server package unless absolute.
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(2048).default(50),
  UPLOAD_MAX_FILES: z.coerce.number().int().positive().max(50).default(5),
  // The most one workspace's request files may take up together, in MB. A request that would pass it is refused.
  UPLOAD_MAX_WORKSPACE_MB: z.coerce.number().positive().max(1_000_000).default(500),
  // Uploads are refused while the disk has less than this free, in MB, so the database always has room to write.
  UPLOAD_MIN_FREE_MB: z.coerce.number().min(0).max(1_000_000).default(100),
  // Files of requests that were rejected or finished this many days ago are deleted. 0 keeps them for ever.
  UPLOAD_KEEP_DAYS: z.coerce.number().int().min(0).max(36_500).default(90),
  // Emails: password reset links, and status updates to people who sent a job request.
  // RESEND_API_KEY sends over HTTPS, which works on hosts that block outgoing SMTP (it wins when both are set).
  // SMTP_URL is the alternative, e.g. smtps://user:pass@smtp.example.com:465. With neither, emails are printed to the log.
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Wrkbench <no-reply@localhost>'),
  // Whether a new account must open a link sent to its address before it can be added to someone else's workspace.
  // "auto" asks for it when email can actually be sent (RESEND_API_KEY or SMTP_URL), and not otherwise.
  EMAIL_CONFIRMATION: z.enum(['auto', 'on', 'off']).default('auto'),
  // Whether a new password is looked up among passwords known from data leaks (the Have I Been Pwned range
  // lookup: neither the password nor its full hash is sent). "off" makes no outside call and uses only the
  // built-in list of common passwords.
  PASSWORD_BREACH_CHECK: z.enum(['on', 'off']).default('on'),
  // Where the app is reached, for links in emails. Defaults to CLIENT_ORIGIN.
  APP_URL: z.string().optional(),
  // The site address passkeys are tied to. Leave it unset to use the host name of APP_URL (or CLIENT_ORIGIN).
  // Set it to a parent of that name (example.com for www.example.com) so passkeys survive a move between the two.
  // Changing it later stops every passkey already made: see the Self-hosting guide.
  PASSKEY_SITE: optionalText,
  // Connected printers. PRINTERS_ENABLED=false hides the feature and refuses bridges.
  PRINTERS_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  BRIDGE_MAX_PER_WORKSPACE: z.coerce.number().int().min(0).max(50).default(3),
  PRINTER_MAX_PER_BRIDGE: z.coerce.number().int().min(1).max(64).default(20),
  // The container image named in the set-up command shown to admins.
  BRIDGE_IMAGE: z.string().default('ghcr.io/hussxin5046/wrkbench-bridge:latest'),
  // Location displays: small screens on shelves that show what is stored there. DEVICES_ENABLED=false refuses them.
  DEVICES_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  DEVICE_MAX_PER_WORKSPACE: z.coerce.number().int().min(0).max(100).default(5),
  UPLOAD_EXTENSIONS: z.string().default('3mf,stl,step,stp,obj,amf,gcode,nc,svg,dxf,pdf,png,jpg,jpeg,txt'),
  // Backups to S3-compatible storage somewhere else (Cloudflare R2, Backblaze B2, Amazon S3, MinIO ...).
  // Set the endpoint, bucket and both keys to switch them on; with none set there are no backups.
  BACKUP_S3_ENDPOINT: optionalText.pipe(z.url('BACKUP_S3_ENDPOINT must be an address such as https://s3.example.com').optional()),
  BACKUP_S3_BUCKET: optionalText,
  // "auto" suits Cloudflare R2. Backblaze B2 and Amazon S3 need their own, such as us-west-004 or eu-west-2.
  BACKUP_S3_REGION: z.string().min(1).default('auto'),
  BACKUP_S3_ACCESS_KEY_ID: optionalText,
  BACKUP_S3_SECRET_ACCESS_KEY: optionalText,
  // How many copies of the database to keep: the newest of each of the last days, and of each of the last weeks.
  BACKUP_KEEP_DAILY: z.coerce.number().int().min(1).max(365).default(7),
  BACKUP_KEEP_WEEKLY: z.coerce.number().int().min(0).max(520).default(4),
  // Who is told when something needs the attention of whoever runs the server, such as a backup that failed.
  ALERT_EMAIL: optionalText.pipe(z.email('ALERT_EMAIL must be an email address').optional()),
  // Set to "latest", or to the name of one backup, to put that backup back when the server next starts.
  // It happens once per value: see the Self-hosting guide before using it.
  RESTORE_BACKUP: optionalText,
});

const BACKUP_KEYS = ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY_ID', 'BACKUP_S3_SECRET_ACCESS_KEY'] as const;

const parsed = schema
  .superRefine((value, context) => {
    const missing = BACKUP_KEYS.filter((key) => !value[key]);
    if (missing.length > 0 && missing.length < BACKUP_KEYS.length) {
      for (const key of missing) context.addIssue({ code: 'custom', path: [key], message: 'Backups need all four of the endpoint, bucket and both keys' });
    }
    const site = passkeySiteFrom(value);
    if (typeof site === 'string') context.addIssue({ code: 'custom', path: ['PASSKEY_SITE'], message: site });
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment. Copy server/.env.example to server/.env and fill it in, or set these on your host.');
  console.error(parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const env = parsed.data;
