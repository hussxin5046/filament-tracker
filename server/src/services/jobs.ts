import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '@/db';
import { HttpError, notFound } from '@/http';
import { followJob } from '@/services/requestStatus';
import { moveStock, round } from '@/services/stock';

/**
 * What happens to a job as it moves: started, finished, cancelled. Kept apart from the routes so that a connected
 * printer can move a job the same way a member pressing the button does, with the same guards.
 */

/** New jobs, and jobs moved to another machine, join the end of that machine's queue. */
export async function endOfQueue(db: Db, workspaceId: string, machineId: string | null | undefined): Promise<number> {
  const last = await db.job.aggregate({ where: { workspaceId, machineId: machineId ?? null, status: { in: ['planned', 'in_progress'] } }, _max: { queuePosition: true } });
  return (last._max.queuePosition ?? -1) + 1;
}

export const jobInclude = {
  machine: { select: { id: true, name: true, hourlyCost: true } },
  createdBy: { select: { name: true } },
  project: { select: { id: true, name: true } },
  // Jobs approved from an outside request carry the requester and their files.
  request: { select: { id: true, requesterName: true, requesterEmail: true, files: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true, size: true } } } },
  usages: { include: { item: { select: { id: true, name: true, unitCost: true, lifeHours: true, quantity: true, unitId: true, itemTypeId: true } } } },
} satisfies Prisma.JobInclude;
export type JobRow = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

interface CostLine {
  quantity: number;
  hours: number;
  item: { unitCost: number; lifeHours: number | null };
}

/** Material is charged by quantity; tooling is amortised over its expected life. */
function lineCost({ quantity, hours, item }: CostLine) {
  const material = quantity * item.unitCost;
  const tooling = item.lifeHours && hours > 0 ? (hours / item.lifeHours) * item.unitCost : 0;
  return { material, tooling };
}

function costJob(job: { durationHours: number; extraCost: number; machine: { hourlyCost: number } | null; usages: CostLine[] }) {
  let materialCost = 0;
  let toolingCost = 0;
  for (const usage of job.usages) {
    const { material, tooling } = lineCost(usage);
    materialCost += material;
    toolingCost += tooling;
  }
  const machineCost = job.durationHours * (job.machine?.hourlyCost ?? 0);
  return {
    materialCost: round(materialCost, 2),
    toolingCost: round(toolingCost, 2),
    machineCost: round(machineCost, 2),
    totalCost: round(materialCost + toolingCost + machineCost + job.extraCost, 2),
  };
}

export const isOpen = (status: string) => status === 'planned' || status === 'in_progress';

/** Finished jobs keep the costs snapshotted at completion; open jobs show a live estimate. */
export const presentJob = (job: JobRow) => (isOpen(job.status) ? { ...job, ...costJob(job) } : job);

/**
 * Start a planned job. Claimed in one conditional write, so a member and a printer starting it at the same
 * moment cannot both do it; the loser gets a 409.
 */
export async function startJob(workspaceId: string, jobId: string, options: { at?: Date } = {}): Promise<JobRow> {
  const existing = await prisma.job.findFirst({ where: { id: jobId, workspaceId } });
  if (!existing) throw notFound('Job');
  if (existing.status !== 'planned') throw new HttpError(409, 'Only planned jobs can be started');
  const claimed = await prisma.job.updateMany({ where: { id: jobId, status: 'planned' }, data: { status: 'in_progress', startedAt: options.at ?? new Date() } });
  if (claimed.count !== 1) throw new HttpError(409, 'Only planned jobs can be started');
  if (existing.machineId) await prisma.machine.updateMany({ where: { id: existing.machineId, status: 'ready' }, data: { status: 'in_use' } });
  await followJob(jobId, 'in_progress');
  return prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
}

export interface FinishOptions {
  outcome?: 'completed' | 'failed';
  /** The member who finished it; null when a connected printer did. */
  userId: string | null;
  at?: Date;
  /** The real run time, when a printer measured it. Replaces the estimate. */
  durationHours?: number;
  failureReason?: string;
}

/**
 * Finish a job. Whether it succeeded or failed, the material is gone and the tooling is worn,
 * so both outcomes take stock, add tool hours and machine hours, and snapshot the cost.
 * Takes stock exactly once however many callers race: the status is flipped first, conditionally.
 */
export async function finishJob(workspaceId: string, jobId: string, { outcome = 'completed', userId, at, durationHours, failureReason }: FinishOptions): Promise<JobRow> {
  const job = await prisma.$transaction(
    async (tx) => {
      if (durationHours !== undefined) await tx.job.updateMany({ where: { id: jobId, workspaceId, status: { in: ['planned', 'in_progress'] } }, data: { durationHours } });
      const current = await tx.job.findFirst({ where: { id: jobId, workspaceId }, include: jobInclude });
      if (!current) throw notFound('Job');
      if (!isOpen(current.status)) throw new HttpError(409, 'This job is already finished');

      // Flip the status first, conditionally, so two finishing at once cannot both take stock.
      const claimed = await tx.job.updateMany({
        where: { id: jobId, status: current.status },
        data: { status: outcome, completedAt: at ?? new Date(), ...(failureReason !== undefined ? { failureReason } : {}), ...costJob(current) },
      });
      if (claimed.count !== 1) throw new HttpError(409, 'This job is already finished');

      for (const usage of current.usages) {
        const { material, tooling } = lineCost(usage);
        await tx.jobUsage.update({ where: { id: usage.id }, data: { cost: round(material + tooling, 2) } });
        if (usage.quantity > 0) {
          await moveStock(tx, { workspaceId, itemId: usage.itemId, delta: -usage.quantity, reason: 'job', note: current.name, jobId, userId });
        }
        if (usage.hours > 0) {
          const item = await tx.item.update({ where: { id: usage.itemId }, data: { usageHours: { increment: usage.hours } } });
          if (item.lifeHours && item.usageHours >= item.lifeHours && !item.wearFlag) {
            await tx.item.update({ where: { id: item.id }, data: { wearFlag: true } });
          }
        }
      }

      if (current.machineId) {
        await tx.machine.update({ where: { id: current.machineId }, data: { usageHours: { increment: current.durationHours } } });
        await tx.machine.updateMany({ where: { id: current.machineId, status: 'in_use' }, data: { status: 'ready' } });
      }
      return tx.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
    },
    { timeout: 30_000 },
  );
  // A failed run is not the requester's job done: it stays where it is until someone reruns it or sets it by hand.
  if (outcome === 'completed') await followJob(jobId, 'done');
  return job;
}

/**
 * Record material used by a job that has already finished (a print started at the printer, a laser job whose sheet
 * the printer cannot see). Takes the stock now, through moveStock, and adds the cost to the job's snapshot.
 */
export async function addUsageToFinishedJob(workspaceId: string, jobId: string, input: { itemId: string; quantity: number; hours: number }, userId: string | null): Promise<JobRow> {
  return prisma.$transaction(
    async (tx) => {
      const job = await tx.job.findFirst({ where: { id: jobId, workspaceId }, include: jobInclude });
      if (!job) throw notFound('Job');
      if (job.status !== 'completed' && job.status !== 'failed') throw new HttpError(409, 'Only finished jobs can have material added this way. Use Edit on an open job.');
      const item = await tx.item.findFirst({ where: { id: input.itemId, workspaceId } });
      if (!item) throw new HttpError(404, 'Item not found');
      if (input.quantity <= 0 && input.hours <= 0) throw new HttpError(400, 'Say how much was used');

      const { material, tooling } = lineCost({ quantity: input.quantity, hours: input.hours, item });
      const cost = round(material + tooling, 2);
      const existing = job.usages.find((u) => u.itemId === input.itemId);
      if (existing) {
        await tx.jobUsage.update({ where: { id: existing.id }, data: { quantity: { increment: input.quantity }, hours: { increment: input.hours }, cost: { increment: cost } } });
      } else {
        await tx.jobUsage.create({ data: { jobId, itemId: input.itemId, quantity: input.quantity, hours: input.hours, cost } });
      }
      if (input.quantity > 0) await moveStock(tx, { workspaceId, itemId: input.itemId, delta: -input.quantity, reason: 'job', note: job.name, jobId, userId });
      if (input.hours > 0) {
        const worn = await tx.item.update({ where: { id: input.itemId }, data: { usageHours: { increment: input.hours } } });
        if (worn.lifeHours && worn.usageHours >= worn.lifeHours && !worn.wearFlag) await tx.item.update({ where: { id: worn.id }, data: { wearFlag: true } });
      }
      await tx.job.update({
        where: { id: jobId },
        data: { materialCost: round(job.materialCost + material, 2), toolingCost: round(job.toolingCost + tooling, 2), totalCost: round(job.totalCost + material + tooling, 2) },
      });
      return tx.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
    },
    { timeout: 30_000 },
  );
}

export async function cancelJob(workspaceId: string, jobId: string): Promise<JobRow> {
  const existing = await prisma.job.findFirst({ where: { id: jobId, workspaceId } });
  if (!existing) throw notFound('Job');
  if (!isOpen(existing.status)) throw new HttpError(409, 'This job is already finished');
  const claimed = await prisma.job.updateMany({ where: { id: jobId, status: existing.status }, data: { status: 'cancelled', completedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(409, 'This job is already finished');
  if (existing.machineId && existing.status === 'in_progress') await prisma.machine.updateMany({ where: { id: existing.machineId, status: 'in_use' }, data: { status: 'ready' } });
  return prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: jobInclude });
}
