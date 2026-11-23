import { useState, type ReactNode } from 'react';
import { Figure, Ledger, Muted } from '@/components/ui/Display';
import { ScrollFrame } from '@/components/ui/ScrollFrame';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { PROJECT_STAGE, PROJECT_STAGES } from '@/lib/status';
import type { Project, ProjectStage } from '@/lib/types';
import styles from '@/components/jobs/Jobs.module.css';

interface Props {
  projects: Project[];
  /** Open a project. `stage` is where it was dropped when it still needs a price before it can go there. */
  onOpen: (id: string, stage?: ProjectStage) => void;
  empty: ReactNode;
}

const sum = (projects: Project[], pick: (project: Project) => number | null) => projects.reduce((total, project) => total + (pick(project) ?? 0), 0);

/** Projects as cards in a column per stage. Each card adds up its jobs and shows the profit, or a price to ask. */
export function ProjectBoard({ projects, onOpen, empty }: Props) {
  const { canEdit, wsPath, money } = useWorkspace();
  const { run, busy } = useAction();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ProjectStage | null>(null);

  if (projects.length === 0) return <>{empty}</>;

  const priced = projects.filter((project) => project.price !== null);
  const profit = sum(priced, (project) => project.totals.profit);
  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };

  const move = (id: string, stage: ProjectStage) => {
    const project = projects.find((p) => p.id === id);
    if (!project || project.stage === stage) return;
    // Invoiced and paid need a price: open the project there to ask for it.
    if (stage !== 'open' && project.price === null) return onOpen(id, stage);
    void run(() => api.put(wsPath(`/projects/${id}/pricing`)!, { stage }), `${project.name} moved to ${PROJECT_STAGE[stage].label}`);
  };

  return (
    <div className={styles.board}>
      <Ledger
        label="All projects"
        entries={[
          { label: 'Cost', value: money(sum(projects, (project) => project.totals.cost)) },
          { label: 'Invoiced', value: money(sum(priced, (project) => project.price)), active: priced.length > 0 },
          { label: 'Profit', value: money(profit), tone: profit < 0 ? 'danger' : 'ok', active: priced.length > 0 },
          { label: 'Not priced', value: projects.length - priced.length, active: projects.length > priced.length },
        ]}
      />

      <ScrollFrame scrollerClassName={styles.columns} step="item" watch={projects}>
        {PROJECT_STAGES.map((stage) => {
          const inStage = projects.filter((project) => project.stage === stage);
          const isTarget = over === stage && dragging !== null && projects.find((p) => p.id === dragging)?.stage !== stage;
          return (
            <section
              key={stage}
              className={`${styles.column} ${isTarget ? styles.columnOver : ''}`}
              aria-label={PROJECT_STAGE[stage].label}
              onDragOver={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                setOver(stage);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) move(dragging, stage);
                endDrag();
              }}
            >
              <header className={styles.columnHead}>
                <h2 className={styles.columnName}>
                  {PROJECT_STAGE[stage].label}
                  <span className={styles.columnCount}>{inStage.length}</span>
                </h2>
                {inStage.length > 0 && <Figure>{money(stage === 'open' ? sum(inStage, (project) => project.totals.cost) : sum(inStage, (project) => project.price))}</Figure>}
              </header>

              {inStage.length === 0 ? (
                <p className={styles.columnEmpty}>{canEdit ? 'Drag a project here.' : 'Nothing here.'}</p>
              ) : (
                inStage.map((project) => {
                  const { totals } = project;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className={`${styles.card} ${dragging === project.id ? styles.cardDragging : ''}`}
                      onClick={() => onOpen(project.id)}
                      draggable={canEdit && !busy}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', project.name);
                        setDragging(project.id);
                      }}
                      onDragEnd={endDrag}
                    >
                      <span className={styles.cardName}>{project.name}</span>
                      <Muted>{[project.customer, `${project.jobs.length} ${project.jobs.length === 1 ? 'job' : 'jobs'}`].filter(Boolean).join(' · ')}</Muted>
                      <span className={styles.cardFigures}>
                        <span className={styles.cardFigure}>
                          <span className={styles.cardLabel}>{totals.estimated ? 'Est. cost' : 'Cost'}</span>
                          <Figure>{money(totals.cost)}</Figure>
                        </span>
                        {totals.price !== null && totals.profit !== null ? (
                          <>
                            <span className={styles.cardFigure}>
                              <span className={styles.cardLabel}>Price</span>
                              <Figure>{money(totals.price)}</Figure>
                            </span>
                            <span className={styles.cardFigure}>
                              <span className={styles.cardLabel}>{totals.profit < 0 ? 'Loss' : 'Profit'}</span>
                              <Figure tone={totals.profit < 0 ? 'danger' : 'ok'}>{money(Math.abs(totals.profit))}</Figure>
                            </span>
                          </>
                        ) : project.jobs.length > 0 ? (
                          <span className={styles.cardFigure}>
                            <span className={styles.cardLabel}>Recommended price</span>
                            <Figure tone="accent">{money(totals.recommendedPrice)}</Figure>
                            <Muted>for a {formatNumber(totals.marginPercent, 1)}% margin</Muted>
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </section>
          );
        })}
      </ScrollFrame>
    </div>
  );
}
