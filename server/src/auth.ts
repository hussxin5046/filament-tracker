import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@/env';
import { prisma } from '@/db';
import { HttpError, param } from '@/http';

export const ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

const rank: Record<Role, number> = { viewer: 1, operator: 2, admin: 3, owner: 4 };

export const atLeast = (role: Role, needed: Role): boolean => rank[role] >= rank[needed];

/**
 * The writes an operator may make: running jobs, logging what was used, servicing machines,
 * loading spools and talking to requesters. Everything else that changes data needs an admin.
 * Paths are relative to /workspaces/:wid. New routes are admin-only until listed here.
 */
const OPERATOR_WRITES: Array<[method: string, path: RegExp]> = [
  ['POST', /^\/items\/[^/]+\/adjust$/], // the handler only lets operators take stock away
  ['POST', /^\/items\/move$/], // putting things away
  ['POST', /^\/items\/[^/]+\/find$/], // lighting the display where a spool is kept
  ['DELETE', /^\/items\/[^/]+\/find$/],
  ['POST', /^\/items\/[^/]+\/take-out$/], // picking a spool: it is on the move
  ['PUT', /^\/items\/[^/]+\/tag$/], // writing or scanning a spool's sticker
  ['POST', /^\/jobs$/],
  ['PATCH', /^\/jobs\/[^/]+$/],
  ['POST', /^\/jobs\/[^/]+\/(start|finish|cancel)$/],
  ['PUT', /^\/jobs\/[^/]+\/project$/], // which project a job belongs to
  ['POST', /^\/projects$/],
  ['PATCH', /^\/projects\/[^/]+$/], // name, customer and notes; price and stage are PUT .../pricing, admins only
  ['PUT', /^\/queue\/[^/]+$/],
  ['POST', /^\/maintenance\/tasks\/[^/]+\/complete$/],
  ['PUT', /^\/sub-units\/[^/]+\/slots\/\d+$/],
  ['PUT', /^\/printers\/by-machine\/[^/]+\/pending-spool$/], // "this spool goes in next"
  ['DELETE', /^\/printers\/by-machine\/[^/]+\/pending-spool$/],
  ['DELETE', /^\/unknown-tags\/[^/]+$/], // "that spool read at a display is not ours"
  ['POST', /^\/job-requests\/[^/]+\/comments$/],
  ['POST', /^\/job-requests\/[^/]+\/status$/],
  ['POST', /^\/ai\/ask$/], // a question to the assistant: it reads the workshop's figures and changes nothing
];

const operatorMay = (method: string, path: string) => OPERATOR_WRITES.some(([m, pattern]) => m === method && pattern.test(path));

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
      workspaceId: string;
      role: Role;
    }
  }
}

interface TokenUser {
  id: string;
  tokenVersion: number;
}

/** The token carries the user's tokenVersion, so raising that number revokes every token issued before. */
// Signing and checking both name the one algorithm, so a token can never choose how it is checked.
const ALGORITHM = 'HS256';

export function signToken(user: TokenUser, expiresIn: `${number}d` = '30d'): string {
  return jwt.sign({ sub: user.id, v: user.tokenVersion }, env.JWT_SECRET, { algorithm: ALGORITHM, expiresIn });
}

/**
 * Five minutes to finish signing in: handed out for the right password on an account with two-step sign-in,
 * and swapped for a real sign-in only together with a code. Never accepted as a sign-in itself.
 */
export function signTwoStepChallenge(user: TokenUser): string {
  return jwt.sign({ sub: user.id, v: user.tokenVersion, purpose: 'twostep' }, env.JWT_SECRET, { algorithm: ALGORITHM, expiresIn: '5m' });
}

/** A one-hour, single-purpose token for the emailed "set a new password" link. Never accepted as a sign-in. */
export function signResetToken(user: TokenUser): string {
  return jwt.sign({ sub: user.id, v: user.tokenVersion, purpose: 'reset' }, env.JWT_SECRET, { algorithm: ALGORITHM, expiresIn: '1h' });
}

/**
 * A one-day, single-purpose token for the emailed "confirm your email" link. It names the address it was sent
 * to, and is not tied to the token version: signing out elsewhere must not break a link still in the inbox.
 */
export function signVerifyToken(user: { id: string; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email, purpose: 'verify' }, env.JWT_SECRET, { algorithm: ALGORITHM, expiresIn: '1d' });
}

type Purpose = 'session' | 'reset' | 'verify' | 'twostep';

function readToken(token: string, purpose: Purpose): { userId: string; version: number; email: string | null } | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
    if (typeof payload !== 'object' || typeof payload.sub !== 'string') return null;
    if ((payload.purpose ?? 'session') !== purpose) return null;
    // Tokens from before versions existed carry none: they count as version 0.
    return { userId: payload.sub, version: typeof payload.v === 'number' ? payload.v : 0, email: typeof payload.email === 'string' ? payload.email : null };
  } catch {
    return null;
  }
}

/** The user a confirmation link belongs to, or null when it is invalid, expired, or was sent to another address. */
export async function userForVerify(token: string) {
  const claims = token ? readToken(token, 'verify') : null;
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.userId } });
  return user && !user.isGuest && user.email === claims.email ? user : null;
}

/** The user a token belongs to, or null when it is invalid, expired, revoked or the account is gone. */
async function userFor(token: string, purpose: 'session' | 'reset' | 'twostep') {
  const claims = token ? readToken(token, purpose) : null;
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.userId } });
  return user && user.tokenVersion === claims.version ? user : null;
}

export const userForSession = (token: string) => userFor(token, 'session');
/** The user who gave the right password a moment ago and now owes the second step. */
export const userForTwoStep = (token: string) => userFor(token, 'twostep');
export const userForReset = (token: string) => userFor(token, 'reset');

export const bearerToken = (header: string | undefined): string => (header?.startsWith('Bearer ') ? header.slice(7) : '');

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const user = await userForSession(bearerToken(req.headers.authorization));
  if (!user) throw new HttpError(401, 'Please sign in');
  req.userId = user.id;
  next();
};

export async function getRole(userId: string, workspaceId: string): Promise<Role | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  return (membership?.role as Role | undefined) ?? null;
}

/**
 * Guards every /workspaces/:wid route: the caller must be a member,
 * viewers only read, operators may make the writes listed in OPERATOR_WRITES, and admins and owners the rest.
 */
export const workspaceGuard: RequestHandler = async (req, _res, next) => {
  const workspaceId = param(req, 'wid');
  const role = await getRole(req.userId, workspaceId);
  if (!role) throw new HttpError(404, 'Workspace not found');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (role === 'viewer') throw new HttpError(403, 'Viewers can look but not change things. Ask an owner for more access.');
    if (role === 'operator' && !operatorMay(req.method, req.path)) {
      throw new HttpError(403, 'Operators can run jobs and log what they use, but not change the inventory or set-up. Ask an admin.');
    }
  }
  req.workspaceId = workspaceId;
  req.role = role;
  next();
};

export const ownerOnly: RequestHandler = (req, _res, next) => {
  if (req.role !== 'owner') throw new HttpError(403, 'Only a workspace owner can do that');
  next();
};
