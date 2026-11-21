import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { prisma } from '@/db';
import { env } from '@/env';
import { errorHandler, HttpError } from '@/http';
import { REPLAYED_HEADER } from '@/idempotency';
import { authRouter } from '@/routes/auth';
import { passkeysRouter } from '@/routes/passkeys';
import { registerActivityRoutes } from '@/routes/activity';
import { registerCatalogRoutes } from '@/routes/catalog';
import { registerItemRoutes } from '@/routes/items';
import { registerJobRoutes } from '@/routes/jobs';
import { deviceRouter, registerDeviceRoutes } from '@/routes/devices';
import { registerMachineRoutes } from '@/routes/machines';
import { registerMaintenanceRoutes } from '@/routes/maintenance';
import { bridgeRouter, registerPrinterRoutes } from '@/routes/printers';
import { registerProjectRoutes } from '@/routes/projects';
import { registerQueueRoutes } from '@/routes/queue';
import { registerReferenceAddRoute } from '@/routes/reference';
import { registerReportRoutes } from '@/routes/reports';
import { publicRequestsRouter, registerRequestRoutes } from '@/routes/requests';
import { registerTransferRoutes } from '@/routes/transfer';
import { workspaceScope, workspacesRouter } from '@/routes/workspaces';
import { UNDO_HEADER } from '@/services/activity';

/** The whole HTTP app, without a port: index.ts listens on it, tests call it directly. */
export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // The host's proxy redirects to HTTPS; leaving this on would break plain-HTTP runs on a local network.
          upgradeInsecureRequests: null,
          // A print's picture is fetched with the sign-in header and shown from a blob: address.
          imgSrc: ["'self'", 'data:', 'blob:'],
        },
      },
    }),
  );
  app.use(cors({ origin: env.CLIENT_ORIGIN, exposedHeaders: [UNDO_HEADER, REPLAYED_HEADER] }));
  app.use(express.json({ limit: '5mb' }));

  // The host asks this to decide whether the app is up. It reads from the database, so an app that cannot is not "up".
  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Everything under /api/workspaces/:wid is membership- and role-checked by workspaceGuard.
  registerCatalogRoutes(workspaceScope);
  registerItemRoutes(workspaceScope);
  registerMachineRoutes(workspaceScope);
  registerMaintenanceRoutes(workspaceScope);
  registerJobRoutes(workspaceScope);
  registerProjectRoutes(workspaceScope);
  registerReportRoutes(workspaceScope);
  registerTransferRoutes(workspaceScope);
  registerRequestRoutes(workspaceScope);
  registerActivityRoutes(workspaceScope);
  registerQueueRoutes(workspaceScope);
  registerReferenceAddRoute(workspaceScope);
  registerPrinterRoutes(workspaceScope);
  registerDeviceRoutes(workspaceScope);

  app.use('/api/auth/passkeys', passkeysRouter);
  app.use('/api/auth', authRouter);
  // The only routes that need no account: sending a job request and following its progress.
  app.use('/api/public', publicRequestsRouter);
  // A bridge swapping its one-time code for a token. Mounted before the signed-in routes, which would refuse it.
  app.use('/api/bridge', bridgeRouter);
  // Location displays: pairing, and the reads and taps made with a display's own token (never a user's).
  app.use('/api/device', deviceRouter);
  app.use('/api', workspacesRouter);
  app.use('/api', () => {
    throw new HttpError(404, 'Not found');
  });

  // In production the API also serves the built client (npm run build), so one process is enough.
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      // Relative to a root, so a dot-folder somewhere above the app (which sendFile refuses) cannot break deep links.
      res.sendFile('index.html', { root: clientDist });
    });
  }

  app.use(errorHandler);

  return app;
}
