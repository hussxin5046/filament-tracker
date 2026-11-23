import type { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db';
import { HttpError, notFound, param, parse } from '@/http';
import { addUsageToFinishedJob, cancelJob, endOfQueue, finishJob, isOpen, jobInclude, presentJob, startJob } from '@/services/jobs';
import { assertInWorkspace } from '@/services/stock';

const usageInput = z.object({
  itemId: z.string().min(1),
  quantity: z.number().min(0).optional(),
  hours: z.number().min(0).optional(),
});

const jobInput = z.object({
  name: z.string().trim().min(1, 'Give the job a name').max(160),
  machineId: z.string().nullable().optional(),
  durationHours: z.number().min(0).max(10_000).optional(),
  notes: z.string().max(5000).optional(),
  extraCost: z.number().min(0).optional(),
  /** -1 low, 0 normal, 1 high, 2 urgent. */
  priority: z.number().int().min(-1).max(2).optional(),
  projectId: z.string().min(1).nullable().optional(),
  usages: z.array(usageInput).max(60).optional(),
});

const finishInput = z.object({ outcome: z.enum(['completed', 'failed']).optional() });

const mergeUsages = (usages: z.output<typeof usageInput>[]) => {
  const merged = new Map<string, { itemId: string; quantity: number; hours: number }>();
  for (const usage of usages) {
    const line = merged.get(usage.itemId) ?? { itemId: usage.itemId, quantity: 0, hours: 0 };
    line.quantity += usage.quantity ?? 0;
    line.hours += usage.hours ?? 0;
    merged.set(usage.itemId, line);
  }
  return [...merged.values()];
};

export function registerJobRoutes(router: Router): void {
  router.get('/jobs', async (req, res) => {
    const jobs = await prisma.job.findMany({
      where: { workspaceId: req.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: jobInclude,
    });
    res.json(jobs.map(presentJob));
  });

  router.post('/jobs', async (req, res) => {
    const { usages = [], ...data } = parse(jobInput, req.body);
    const lines = mergeUsages(usages);
    await assertInWorkspace(prisma, req.workspaceId, { machine: data.machineId, project: data.projectId, item: lines.map((l) => l.itemId) });
    const job = await prisma.job.create({
      data: {
        ...data,
        workspaceId: req.workspaceId,
        createdById: req.userId,
        queuePosition: await endOfQueue(prisma, req.workspaceId, data.machineId),
        usages: { create: lines },
      },
      include: jobInclude,
    });
    res.status(201).json(presentJob(job));
  });

  router.patch('/jobs/:id', async (req, res) => {
    const { usages, ...data } = parse(jobInput.partial(), req.body);
    const id = param(req, 'id');
    const existing = await prisma.job.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) throw notFound('Job');
    if (!isOpen(existing.status)) {
      throw new HttpError(409, 'Finished jobs are locked because stock and tool life were already updated from them');
    }
    const lines = usages ? mergeUsages(usages) : undefined;
    await assertInWorkspace(prisma, req.workspaceId, { machine: data.machineId, project: data.projectId, item: lines?.map((l) => l.itemId) });
    const job = await prisma.job.update({
      where: { id },
      data: {
        ...data,
        ...(data.machineId !== undefined && data.machineId !== existing.machineId ? { queuePosition: await endOfQueue(prisma, req.workspaceId, data.machineId) } : {}),
        ...(lines ? { usages: { deleteMany: {}, create: lines } } : {}),
      },
      include: jobInclude,
    });
    res.json(presentJob(job));
  });

  router.post('/jobs/:id/start', async (req, res) => {
    res.json(presentJob(await startJob(req.workspaceId, param(req, 'id'))));
  });

  /** Finish a job as completed or failed. Either way its materials leave stock (see finishJob). */
  router.post('/jobs/:id/finish', async (req, res) => {
    const { outcome = 'completed' } = parse(finishInput, req.body ?? {});
    res.json(presentJob(await finishJob(req.workspaceId, param(req, 'id'), { outcome, userId: req.userId })));
  });

  /** Material a finished job used that was not recorded. Takes it from stock now and adds its cost to the job. */
  router.post('/jobs/:id/usages', async (req, res) => {
    const { itemId, quantity = 0, hours = 0 } = parse(usageInput, req.body);
    res.status(201).json(presentJob(await addUsageToFinishedJob(req.workspaceId, param(req, 'id'), { itemId, quantity, hours }, req.userId)));
  });

  router.post('/jobs/:id/cancel', async (req, res) => {
    res.json(presentJob(await cancelJob(req.workspaceId, param(req, 'id'))));
  });

  /** Removes the record only. Stock already taken by a finished job stays taken (the movements remain in each item's history). */
  router.delete('/jobs/:id', async (req, res) => {
    const id = param(req, 'id');
    const existing = await prisma.job.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) throw notFound('Job');
    await prisma.job.delete({ where: { id } });
    res.status(204).end();
  });
}
