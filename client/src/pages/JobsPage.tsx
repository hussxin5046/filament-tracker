import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, Check, ClipboardList, FolderKanban, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { AddUsedMaterial } from '@/components/jobs/AddUsedMaterial';
import { JobForm } from '@/components/jobs/JobForm';
import { PrintQueue } from '@/components/jobs/PrintQueue';
import { ProjectBoard } from '@/components/jobs/ProjectBoard';
import { ProjectForm } from '@/components/jobs/ProjectForm';
import { RequestFiles, RequestQueue } from '@/components/requests/RequestQueue';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorNote, Figure, List, Loading, Muted, PageHeader, PageSkeleton, Row, SectionTitle, Tabs } from '@/components/ui/Display';
import { FormGrid, SelectField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatDate, formatHours, formatQuantity } from '@/lib/format';
import { JOB_STATUS, PRIORITY } from '@/lib/status';
import type { Job, JobRequest, MachineQueue, Project, ProjectStage, RequestLink } from '@/lib/types';
import styles from '@/components/jobs/Jobs.module.css';

type Tab = 'open' | 'requests' | 'history' | 'projects';
const isOpen = (job: Job) => job.status === 'planned' || job.status === 'in_progress';

export function JobsPage() {
  const { canEdit, canOperate, wsPath, money } = useWorkspace();
  const catalog = useCatalog();
  const { items } = useItems();
  const { data: allJobs, error } = useWsQuery<Job[]>('/jobs');
  const { data: allRequests } = useWsQuery<JobRequest[]>('/job-requests');
  const { data: requestLink } = useWsQuery<RequestLink>('/request-link');
  const { data: queues } = useWsQuery<MachineQueue[]>('/queue');
  const { data: projects } = useWsQuery<Project[]>('/projects');
  const { machine } = useMachineFocus();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('open');
  const [viewId, setViewId] = useState<string | null>(null);
  const [form, setForm] = useState<{ job?: Job } | null>(null);
  const [addingUsed, setAddingUsed] = useState<Job | null>(null);
  /** The project dialog: an id to open one (with the stage it was dragged to, if it needs a price first), or 'new'. */
  const [projectView, setProjectView] = useState<{ id: string; stage?: ProjectStage } | 'new' | null>(null);

  // A link can ask for a tab (the daily report points at the request queue): /jobs?tab=requests
  const [params] = useSearchParams();
  const askedTab = params.get('tab');
  useEffect(() => {
    if (askedTab === 'open' || askedTab === 'requests' || askedTab === 'history' || askedTab === 'projects') setTab(askedTab);
  }, [askedTab]);

  if (error || catalog.error) return <ErrorNote>{error ?? catalog.error}</ErrorNote>;
  if (!allJobs || catalog.loading) return <PageSkeleton title="Jobs" filters />;

  // With one machine in focus: its jobs, and the requests that asked for it.
  const jobs = machine ? allJobs.filter((job) => job.machineId === machine.id) : allJobs;
  const requests = (allRequests ?? []).filter((request) => !machine || request.machine?.id === machine.id);
  const open = jobs.filter(isOpen);
  const history = jobs.filter((j) => !isOpen(j));
  const viewing = allJobs.find((j) => j.id === viewId);
  const viewingProject = projectView && projectView !== 'new' ? projects?.find((p) => p.id === projectView.id) : undefined;

  const assign = (job: Job, projectId: string) =>
    run(() => api.put(wsPath(`/jobs/${job.id}/project`)!, { projectId: projectId || null }), projectId ? `Added to ${projects?.find((p) => p.id === projectId)?.name ?? 'the project'}` : 'Taken out of its project');

  const act = (job: Job, action: 'start' | 'finish' | 'cancel', body: object, message: string, close = true) =>
    run(() => api.post(wsPath(`/jobs/${job.id}/${action}`)!, body), message).then((ok) => {
      if (ok && close) setViewId(null);
    });

  const fail = async (job: Job) => {
    const ok = await confirm({
      title: 'Mark as failed?',
      message: 'The materials and tool hours on this job are still taken from stock, because a failed run uses them up too. Edit the quantities first if less was used.',
      confirmLabel: 'Mark failed',
      danger: true,
    });
    if (ok) await act(job, 'finish', { outcome: 'failed' }, 'Marked as failed. Stock updated.');
  };

  const remove = async (job: Job) => {
    const ok = await confirm({
      title: 'Delete job?',
      message: isOpen(job) ? `"${job.name}" will be removed.` : `"${job.name}" will be removed from history. Stock it already used is not put back.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && (await run(() => api.delete(wsPath(`/jobs/${job.id}`)!), 'Job deleted'))) setViewId(null);
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle={tab === 'projects' ? 'Jobs grouped into the work they belong to: what each project cost, and its profit or a price to ask.' : machine ? `The queue on ${machine.name}, and requests that asked for it.` : 'Open jobs queue per machine by priority, with estimated finish times. Finishing a job takes its material from stock.'}
        actions={
          canOperate &&
          (tab === 'projects' ? (
            <Button variant="primary" icon={Plus} onClick={() => setProjectView('new')}>
              New project
            </Button>
          ) : (
            <Button variant="primary" icon={Plus} onClick={() => setForm({})}>
              New job
            </Button>
          ))
        }
      />

      <Tabs
        tabs={[
          { id: 'open', label: 'Queue', count: open.length },
          { id: 'requests', label: 'Requests', count: requests.filter((request) => request.status === 'pending').length },
          { id: 'history', label: 'History', count: history.length },
          { id: 'projects', label: 'Projects', count: projects?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'requests' ? (
        <RequestQueue requests={requests} link={requestLink} catalog={catalog} machineName={machine?.name} />
      ) : tab === 'projects' ? (
        !projects ? (
          <Loading />
        ) : (
          <ProjectBoard
            projects={projects}
            onOpen={(id, stage) => setProjectView({ id, stage })}
            empty={
              <EmptyState icon={FolderKanban} title="No projects yet" action={canOperate && <Button variant="primary" icon={Plus} onClick={() => setProjectView('new')}>New project</Button>}>
                A project gathers the jobs done for one piece of work, adds up what they cost, and shows the profit or a price to ask.
              </EmptyState>
            }
          />
        )
      ) : tab === 'open' ? (
        <PrintQueue
          queues={queues}
          jobs={allJobs}
          machineId={machine?.id}
          onOpen={setViewId}
          empty={
            <EmptyState icon={ClipboardList} title="No open jobs" action={canOperate && <Button variant="primary" icon={Plus} onClick={() => setForm({})}>New job</Button>}>
              Plan a job to check you have the material, or log one you have just finished.
            </EmptyState>
          }
        />
      ) : history.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No finished jobs yet">
          Finished, failed and cancelled jobs appear here with their cost.
        </EmptyState>
      ) : (
        <List>
          {history.map((job) => {
            const context = [job.machine?.name, formatHours(job.durationHours), formatDate(job.completedAt ?? job.createdAt), job.request ? `for ${job.request.requesterName}` : '', job.project?.name].filter(Boolean).join(' · ');
            return (
              <Row
                key={job.id}
                onClick={() => setViewId(job.id)}
                title={job.name}
                subtitle={context}
                trailing={
                  <>
                    <Figure>{money(job.totalCost)}</Figure>
                    <Badge tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Badge>
                  </>
                }
              />
            );
          })}
        </List>
      )}

      {viewing && !form && !projectView && !addingUsed && (
        <Modal
          title={viewing.name}
          size="lg"
          onClose={() => setViewId(null)}
          footer={
            canOperate ? (
              <>
                {canEdit && (
                  <Button variant="danger" icon={Trash2} onClick={() => remove(viewing)} disabled={busy}>
                    Delete
                  </Button>
                )}
                {(viewing.status === 'completed' || viewing.status === 'failed') && (
                  <Button icon={Plus} onClick={() => setAddingUsed(viewing)}>
                    Add material used
                  </Button>
                )}
                {isOpen(viewing) && (
                  <>
                    <Button icon={Ban} onClick={() => act(viewing, 'cancel', {}, 'Job cancelled')} disabled={busy}>
                      Cancel job
                    </Button>
                    <Button icon={Pencil} onClick={() => setForm({ job: viewing })}>
                      Edit
                    </Button>
                    <Button icon={X} onClick={() => fail(viewing)} disabled={busy}>
                      Failed
                    </Button>
                    {viewing.status === 'planned' && (
                      <Button icon={Play} onClick={() => act(viewing, 'start', {}, 'Job started', false)} disabled={busy}>
                        Start
                      </Button>
                    )}
                    <Button variant="primary" icon={Check} onClick={() => act(viewing, 'finish', { outcome: 'completed' }, 'Job finished. Stock and tool life updated.')} disabled={busy}>
                      Finish
                    </Button>
                  </>
                )}
              </>
            ) : undefined
          }
        >
          <div className={styles.meta}>
            <Badge tone={JOB_STATUS[viewing.status].tone}>{JOB_STATUS[viewing.status].label}</Badge>
            {viewing.priority !== 0 && <Badge tone={PRIORITY[viewing.priority].tone}>{PRIORITY[viewing.priority].label} priority</Badge>}
            {viewing.machine && <span>{viewing.machine.name}</span>}
            <Figure>{formatHours(viewing.durationHours)}</Figure>
            <Muted>
              {viewing.completedAt ? `Finished ${formatDate(viewing.completedAt)}` : `Created ${formatDate(viewing.createdAt)}`}
              {viewing.createdBy ? ` · ${viewing.createdBy.name}` : viewing.source === 'printer' ? ' · started at the printer' : ''}
            </Muted>
          </div>
          {viewing.failureReason && <p className={styles.notes}>{viewing.failureReason}</p>}
          {viewing.source === 'printer' && viewing.usages.length === 0 && (viewing.status === 'in_progress' || viewing.status === 'planned') && (
            <Muted>Wrkbench could not tell what this print uses (the sliced file was not readable, or its trays are not linked to stock). Add materials with Edit if you want them taken from stock when it ends.</Muted>
          )}
          {viewing.notes && <p className={styles.notes}>{viewing.notes}</p>}

          {viewing.request && (
            <div>
              <SectionTitle count={viewing.request.files.length}>Files from {viewing.request.requesterName}</SectionTitle>
              <RequestFiles requestId={viewing.request.id} files={viewing.request.files} />
            </div>
          )}

          <div>
            <SectionTitle count={viewing.usages.length}>Used</SectionTitle>
            {viewing.usages.length === 0 ? (
              <Muted>Nothing recorded against this job.</Muted>
            ) : (
              <ul className={styles.usageList}>
                {viewing.usages.map((usage) => {
                  const unit = usage.item.unitId ? catalog.unitById.get(usage.item.unitId) : null;
                  const short = isOpen(viewing) && usage.quantity > usage.item.quantity;
                  return (
                    <li key={usage.id} className={styles.usage}>
                      <span>
                        {usage.item.name}
                        {short && (
                          <>
                            {' '}
                            <Badge tone="danger">only {formatQuantity(usage.item.quantity, unit)} in stock</Badge>
                          </>
                        )}
                      </span>
                      <span className={styles.usageAmounts}>
                        {usage.quantity > 0 && <Figure>{formatQuantity(usage.quantity, unit)}</Figure>}
                        {usage.hours > 0 && <Figure>{formatHours(usage.hours)}</Figure>}
                        {!isOpen(viewing) && usage.cost > 0 && <Muted>{money(usage.cost)}</Muted>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {canOperate && projects && projects.length > 0 ? (
            <FormGrid>
              <SelectField label="Project" value={viewing.project?.id ?? ''} onChange={(projectId) => assign(viewing, projectId)} disabled={busy} hint="Its cost is added to the project's total.">
                <option value="">None</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </SelectField>
            </FormGrid>
          ) : (
            viewing.project && <Muted>Part of the project {viewing.project.name}.</Muted>
          )}

          <dl className={styles.costs}>
            <div><dt>Materials</dt><dd><Figure>{money(viewing.materialCost)}</Figure></dd></div>
            <div><dt>Tool wear</dt><dd><Figure>{money(viewing.toolingCost)}</Figure></dd></div>
            <div><dt>Machine time</dt><dd><Figure>{money(viewing.machineCost)}</Figure></dd></div>
            {viewing.extraCost > 0 && <div><dt>Other</dt><dd><Figure>{money(viewing.extraCost)}</Figure></dd></div>}
            <div className={styles.total}><dt>{isOpen(viewing) ? 'Estimated cost' : 'Cost'}</dt><dd><Figure>{money(viewing.totalCost)}</Figure></dd></div>
          </dl>
        </Modal>
      )}

      {projectView && (projectView === 'new' || viewingProject) && (
        <ProjectForm
          key={projectView === 'new' ? 'new' : projectView.id}
          project={viewingProject}
          jobs={allJobs}
          wantStage={projectView === 'new' ? undefined : projectView.stage}
          onOpenJob={(id) => {
            setProjectView(null);
            setViewId(id);
          }}
          onClose={() => setProjectView(null)}
        />
      )}

      {addingUsed && <AddUsedMaterial job={addingUsed} items={items} catalog={catalog} onClose={() => setAddingUsed(null)} />}

      {form && <JobForm catalog={catalog} items={items} projects={projects ?? []} job={form.job} defaultMachineId={machine?.id} onClose={() => setForm(null)} />}
    </>
  );
}
