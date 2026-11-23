import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, Chip, ChipRow, ErrorNote, List, Loading, Muted, Row, Swatch, Tabs, TypeIcon } from '@/components/ui/Display';
import { Checkbox, FormGrid, NumberField, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useAction, useToast } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useCatalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { flattenLocations, parseNumber } from '@/lib/format';
import {
  fmt, inchLabel, loadEntries, loadFilamentBrands, loadSummary, machineTitle, searchFilament, specText,
  type AddResult, type EntryByKind, type FilamentLine, type ReferenceEndmill, type ReferenceFastener, type ReferenceFinish,
  type ReferenceKind, type ReferenceMachine, type ReferenceSheet, type ReferenceSummary, type Pick,
} from '@/lib/reference';
import { colourChoiceDistance } from '@/lib/spoolMatch';
import itemStyles from '@/components/items/Items.module.css';
import styles from '@/components/reference/ReferencePicker.module.css';

interface Props {
  /** The kinds offered as tabs, e.g. just machines, or the item kinds. */
  kinds: ReferenceKind[];
  onClose: () => void;
  /** Collect mode (workspace set-up): each pick is handed back instead of being added. */
  onCollect?: (pick: Pick, label: string) => void;
  /** Add mode: called after entries were added to the current workspace. */
  onAdded?: (result: AddResult) => void;
  /** Adding one spool a printer reports: start from its material and colour, and mark it as fitting that printer. */
  preset?: SpoolPreset;
}

export interface SpoolPreset {
  material: string | null;
  /** "#rrggbb" as the printer reports it. */
  colour: string | null;
  machineId: string | null;
}

/** The catalogue colour of a product line that looks most like the one the printer reports. */
export function nearestColour(colours: [string, string][], wanted: string | null): string | null {
  if (!wanted || colours.length === 0) return null;
  return colours.reduce((best, candidate) => (colourChoiceDistance(candidate[1], wanted) < colourChoiceDistance(best[1], wanted) ? candidate : best))[0];
}

type Selected = { [K in ReferenceKind]: { kind: K; entry: EntryByKind[K] } }[ReferenceKind];

/** Search and pick from the built-in catalogue, then choose sizes, colours or attachments. */
export function ReferencePicker({ kinds, onClose, onCollect, onAdded, preset }: Props) {
  const [kind, setKind] = useState<ReferenceKind>(kinds[0]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [pick, setPick] = useState<{ pick: Pick; label: string; count: number } | null>(null);
  const [options, setOptions] = useState<{ itemTypeId: string; locationId: string }>({ itemTypeId: '', locationId: '' });
  const [summary, setSummary] = useState<ReferenceSummary | null>(null);
  const [error, setError] = useState('');
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const toast = useToast();

  useEffect(() => {
    loadSummary().then(setSummary, (e: Error) => setError(e.message));
  }, []);

  const choose = (next: Selected) => {
    setPick(null);
    setSelected(next);
  };

  const submit = async () => {
    if (!pick) return;
    if (onCollect) {
      onCollect(pick.pick, pick.label);
      setSelected(null);
      setPick(null);
      return;
    }
    let result: AddResult | undefined;
    const body = { picks: [pick.pick], itemTypeId: options.itemTypeId || null, locationId: options.locationId || null, ...(preset?.machineId ? { machineIds: [preset.machineId] } : {}) };
    const ok = await run(async () => {
      result = await api.post<AddResult>(wsPath('/reference/add')!, body);
    });
    if (ok && result) {
      toast(describeResult(result));
      onAdded?.(result);
    }
  };

  const kindInfo = summary?.kinds.find((k) => k.kind === kind);
  const title = selected ? titleOf(selected) : 'Add from the catalogue';

  return (
    <Modal
      title={title}
      size="lg"
      onClose={onClose}
      onSubmit={selected ? submit : undefined}
      footer={
        <>
          {selected && (
            <Button icon={ArrowLeft} onClick={() => setSelected(null)}>
              Back
            </Button>
          )}
          <Button onClick={onClose}>{onCollect ? 'Done' : 'Cancel'}</Button>
          {selected && (
            <Button type="submit" variant="primary" icon={onCollect ? Plus : Check} disabled={busy || !pick || pick.count === 0}>
              {submitLabel(selected.kind, pick?.count ?? 0, Boolean(onCollect))}
            </Button>
          )}
        </>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {!selected && (
        <div className={styles.browse}>
          {kinds.length > 1 && <Tabs tabs={kinds.map((k) => ({ id: k, label: tabLabel(k) }))} active={kind} onChange={(k) => setKind(k)} />}

          {kind === 'machine' && <MachineBrowser summary={summary} onChoose={(entry) => choose({ kind: 'machine', entry })} />}
          {kind === 'filament' && <FilamentBrowser initialQuery={preset?.material ?? ''} onChoose={(entry) => choose({ kind: 'filament', entry })} />}
          {kind === 'endmill' && (
            <ListBrowser kind="endmill" group={(e) => e.cutType} title={(e) => e.name} subtitle={(e) => [e.toolMaterial, e.ratedFor].filter(Boolean).join(' · ')} onChoose={(entry) => choose({ kind: 'endmill', entry })} />
          )}
          {kind === 'fastener' && (
            <ListBrowser
              kind="fastener"
              group={(e) => e.kind}
              title={(e) => e.name}
              subtitle={(e) => [e.standard, e.materials.map((m) => m.grade ?? m.material).join(' / '), sizeRange(e)].filter(Boolean).join(' · ')}
              onChoose={(entry) => choose({ kind: 'fastener', entry })}
            />
          )}
          {kind === 'sheet' && (
            <ListBrowser kind="sheet" group={(e) => e.material} title={(e) => e.name} subtitle={(e) => `${e.thicknesses.map(fmt).join(', ')} mm${e.note ? ` · ${e.note}` : ''}`} onChoose={(entry) => choose({ kind: 'sheet', entry })} />
          )}
          {kind === 'finish' && (
            <ListBrowser kind="finish" group={(e) => e.kind} title={(e) => e.name} subtitle={(e) => [e.base, e.sheen, e.variants.map((v) => v.label).join(', ')].filter(Boolean).join(' · ')} onChoose={(entry) => choose({ kind: 'finish', entry })} />
          )}
        </div>
      )}

      {selected?.kind === 'machine' && <MachineOptions entry={selected.entry} onChange={setPick} />}
      {selected?.kind === 'filament' && <FilamentOptions entry={selected.entry} onChange={setPick} preset={preset} />}
      {selected?.kind === 'endmill' && <EndmillOptions entry={selected.entry} onChange={setPick} />}
      {selected?.kind === 'fastener' && <FastenerOptions entry={selected.entry} onChange={setPick} />}
      {selected?.kind === 'sheet' && <SheetOptions entry={selected.entry} sizes={summary?.sheetSizes ?? []} onChange={setPick} />}
      {selected?.kind === 'finish' && <FinishOptions entry={selected.entry} onChange={setPick} />}

      {selected && !onCollect && <AddOptions kind={selected.kind} category={kindInfo?.category ?? null} onChange={setOptions} />}

      {kind === 'filament' && summary && (
        <p className={styles.attribution}>
          Filament data from <a href={summary.attribution.filament.url} target="_blank" rel="noreferrer">{summary.attribution.filament.name}</a> ({summary.attribution.filament.licence} licence). Check temperatures against the label on your spool.
        </p>
      )}
    </Modal>
  );
}

// ---- Wording ---------------------------------------------------------------------------------

const TAB_LABELS: Record<ReferenceKind, string> = {
  machine: 'Machines', filament: 'Filament', endmill: 'Endmills', fastener: 'Fixings', sheet: 'Sheet stock', finish: 'Finishing',
};
const tabLabel = (kind: ReferenceKind) => TAB_LABELS[kind];

function titleOf(selected: Selected): string {
  switch (selected.kind) {
    case 'machine': return machineTitle(selected.entry);
    case 'filament': return `${selected.entry.brand} ${selected.entry.name}`;
    default: return selected.entry.name;
  }
}

function submitLabel(kind: ReferenceKind, count: number, collect: boolean): string {
  if (collect) return 'Add to the list';
  if (kind === 'machine') return 'Add machine';
  return count === 1 ? 'Add 1 item' : `Add ${count} items`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describeResult(result: AddResult): string {
  const added = [
    ...result.machines.map((m) => m.name),
    result.items ? `${plural(result.items, 'item')}${result.category ? ` to ${result.category.name}` : ''}` : '',
    !result.machines.length && result.subUnits ? plural(result.subUnits, 'attachment') : '',
  ].filter(Boolean);
  const skipped = result.skipped.length ? `${result.skipped.length} already there` : '';
  return [added.length ? `Added ${added.join(' and ')}` : 'Nothing new to add', skipped].filter(Boolean).join(' · ');
}

function sizeRange(fastener: ReferenceFastener): string {
  const sizes = fastener.sizes.map((s) => s.size);
  return sizes.length > 1 ? `${sizes[0]} to ${sizes.at(-1)}` : sizes[0] ?? '';
}

// ---- Browsing ----------------------------------------------------------------------------------

function useEntries<K extends Exclude<ReferenceKind, 'filament'>>(kind: K) {
  const [entries, setEntries] = useState<EntryByKind[K][] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    loadEntries(kind).then((list) => live && setEntries(list), (e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [kind]);
  return { entries, error };
}

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (text: string, query: string) => words(query).every((w) => text.toLowerCase().includes(w));

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className={`${itemStyles.search} ${styles.search}`}>
      <Search size={18} aria-hidden />
      <input className={itemStyles.searchInput} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} enterKeyHint="search" autoFocus />
    </label>
  );
}

function Results({ children, total, shown }: { children: ReactNode; total: number; shown: number }) {
  if (total === 0) return <Muted>Nothing matches. Try fewer words, or add it by hand afterwards.</Muted>;
  return (
    <div className={styles.results}>
      <List>{children}</List>
      {shown < total && <Muted>Showing {shown} of {total}. Type more to narrow it down.</Muted>}
    </div>
  );
}

function MachineBrowser({ summary, onChoose }: { summary: ReferenceSummary | null; onChoose: (entry: ReferenceMachine) => void }) {
  const { entries, error } = useEntries('machine');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const types = useMemo(() => [...new Set(entries?.map((e) => e.machineType) ?? [])], [entries]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!entries) return <Loading />;
  const shown = entries.filter((e) => (!type || e.machineType === type) && matches(`${machineTitle(e)} ${e.summary ?? ''}`, query));
  return (
    <>
      <SearchBox value={query} onChange={setQuery} placeholder="Search makes and models" />
      <ChipRow label="Machine type">
        <Chip active={!type} onClick={() => setType('')}>All</Chip>
        {types.map((t) => (
          <Chip key={t} active={type === t} onClick={() => setType(type === t ? '' : t)} count={entries.filter((e) => e.machineType === t).length}>
            {summary?.machineTypes[t]?.name ?? t}
          </Chip>
        ))}
      </ChipRow>
      <Results total={shown.length} shown={shown.length}>
        {shown.map((entry) => (
          <Row
            key={entry.id}
            onClick={() => onChoose(entry)}
            leading={<TypeIcon icon={summary?.machineTypes[entry.machineType]?.icon ?? 'Cog'} size="sm" />}
            title={machineTitle(entry)}
            subtitle={[entry.summary, ...entry.specs.slice(0, 2).map(specText)].filter(Boolean).join(' · ') || (entry.brand ? undefined : 'Generic')}
          />
        ))}
      </Results>
    </>
  );
}

function FilamentBrowser({ onChoose, initialQuery = '' }: { onChoose: (entry: FilamentLine) => void; initialQuery?: string }) {
  const [brands, setBrands] = useState<{ brand: string; lines: number }[] | null>(null);
  const [brand, setBrand] = useState('');
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<{ total: number; entries: FilamentLine[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadFilamentBrands().then(setBrands, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    let live = true;
    // Wait for a pause in typing before asking the server.
    const timer = setTimeout(() => {
      searchFilament(brand, query).then((r) => live && setResult(r), (e: Error) => live && setError(e.message));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [brand, query]);

  return (
    <>
      <FormGrid>
        <SelectField label="Brand" value={brand} onChange={setBrand}>
          <option value="">All brands</option>
          {brands?.map((b) => (
            <option key={b.brand} value={b.brand}>
              {b.brand} ({b.lines})
            </option>
          ))}
        </SelectField>
      </FormGrid>
      <SearchBox value={query} onChange={setQuery} placeholder="Search product, material or colour" />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!result ? (
        <Loading />
      ) : (
        <Results total={result.total} shown={result.entries.length}>
          {result.entries.map((line) => (
            <Row
              key={line.id}
              onClick={() => onChoose(line)}
              leading={<span className={styles.swatchStack}>{line.colours.slice(0, 3).map(([name, hex]) => <Swatch key={name} color={hex} size={14} />)}</span>}
              title={`${line.brand} ${line.name}`}
              subtitle={[line.materialCode, plural(line.colours.length, 'colour'), line.finish].filter(Boolean).join(' · ')}
            />
          ))}
        </Results>
      )}
    </>
  );
}

function ListBrowser<K extends 'endmill' | 'fastener' | 'sheet' | 'finish'>({ kind, group, title, subtitle, onChoose }: {
  kind: K;
  group: (entry: EntryByKind[K]) => string;
  title: (entry: EntryByKind[K]) => string;
  subtitle: (entry: EntryByKind[K]) => string;
  onChoose: (entry: EntryByKind[K]) => void;
}) {
  const { entries, error } = useEntries(kind);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => [...new Set(entries?.map(group) ?? [])], [entries, group]);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!entries) return <Loading />;
  const shown = entries.filter((e) => (!filter || group(e) === filter) && matches(`${title(e)} ${subtitle(e)} ${group(e)}`, query));
  return (
    <>
      <SearchBox value={query} onChange={setQuery} placeholder={`Search ${tabLabel(kind).toLowerCase()}`} />
      {groups.length > 1 && (
        <ChipRow label="Filter">
          <Chip active={!filter} onClick={() => setFilter('')}>All</Chip>
          {groups.map((g) => (
            <Chip key={g} active={filter === g} onClick={() => setFilter(filter === g ? '' : g)}>
              {g}
            </Chip>
          ))}
        </ChipRow>
      )}
      <Results total={shown.length} shown={shown.length}>
        {shown.map((entry) => (
          <Row key={entry.id} onClick={() => onChoose(entry)} title={title(entry)} subtitle={subtitle(entry)} />
        ))}
      </Results>
    </>
  );
}

// ---- Choosing options ---------------------------------------------------------------------------

type OnPick = (value: { pick: Pick; label: string; count: number } | null) => void;

function Facts({ items }: { items: (string | false | undefined | null)[] }) {
  const shown = items.filter(Boolean) as string[];
  if (!shown.length) return null;
  return (
    <div className={styles.facts}>
      {shown.map((fact) => (
        <Badge key={fact}>{fact}</Badge>
      ))}
    </div>
  );
}

/** Multi-select chips with All / None. */
function ChoiceChips<T extends string | number>({ label, options, chosen, onChange, render }: {
  label: string;
  options: T[];
  chosen: T[];
  onChange: (next: T[]) => void;
  render?: (option: T) => ReactNode;
}) {
  const toggle = (option: T) => onChange(chosen.includes(option) ? chosen.filter((c) => c !== option) : [...chosen, option]);
  return (
    <div className={styles.choice}>
      <div className={styles.choiceHead}>
        <strong>{label}</strong>
        {options.length > 3 && (
          <span className={styles.choiceActions}>
            <Button size="sm" variant="ghost" onClick={() => onChange([...options])}>All</Button>
            <Button size="sm" variant="ghost" onClick={() => onChange([])}>None</Button>
          </span>
        )}
      </div>
      <div className={styles.chipWrap} role="group" aria-label={label}>
        {options.map((option) => (
          <Chip key={String(option)} active={chosen.includes(option)} onClick={() => toggle(option)}>
            {render ? render(option) : String(option)}
          </Chip>
        ))}
      </div>
    </div>
  );
}

const countOf = (text: string, min = 0) => Math.max(min, Math.floor(parseNumber(text) ?? min));

function MachineOptions({ entry, onChange }: { entry: ReferenceMachine; onChange: OnPick }) {
  const [attachments, setAttachments] = useState<string[]>(() => (entry.attachments ?? []).filter((a) => a.builtIn).map((a) => a.id));
  useEffect(() => {
    const fitted = (entry.attachments ?? []).filter((a) => attachments.includes(a.id)).map((a) => a.name);
    onChange({ pick: { kind: 'machine', id: entry.id, attachments }, label: `${machineTitle(entry)}${fitted.length ? ` with ${fitted.join(' and ')}` : ''}`, count: 1 });
  }, [entry, attachments, onChange]);
  return (
    <>
      <Facts items={[entry.summary, ...entry.specs.map((s) => `${s.label} ${specText(s)}`)]} />
      {entry.asUnit && <Muted>Added as attached hardware with {plural(entry.asUnit.slots, 'slot')}, ready to load spools into.</Muted>}
      {entry.attachments?.length ? (
        <div className={styles.choice}>
          <strong>Fitted with</strong>
          {entry.attachments.map((a) => (
            <Checkbox
              key={a.id}
              label={a.name}
              hint={`${a.kind}${a.slots ? `, ${plural(a.slots, 'slot')}` : ''}`}
              checked={attachments.includes(a.id)}
              onChange={(on) => setAttachments((current) => (on ? [...current, a.id] : current.filter((id) => id !== a.id)))}
            />
          ))}
        </div>
      ) : null}
      {entry.tasks?.length ? <Muted>Comes with {plural(entry.tasks.length, 'maintenance schedule')}: {entry.tasks.map((t) => t.name).join('; ')}.</Muted> : null}
      {!entry.asUnit && <Muted>Its machine type and that type's maintenance schedules are added too if the workspace does not have them yet.</Muted>}
    </>
  );
}

function FilamentOptions({ entry, onChange, preset }: { entry: FilamentLine; onChange: OnPick; preset?: SpoolPreset }) {
  const [weight, setWeight] = useState(String(entry.weights[0].g));
  const [diameter, setDiameter] = useState(String(entry.diameters.includes(1.75) ? 1.75 : entry.diameters[0]));
  // For a spool a printer reports, start on the colour that looks most like it.
  const likely = preset ? nearestColour(entry.colours, preset.colour) : null;
  const [colours, setColours] = useState<string[]>(likely ? [likely] : entry.colours.length === 1 ? [entry.colours[0][0]] : []);
  const [spools, setSpools] = useState('1');
  const hex = useMemo(() => new Map(entry.colours), [entry]);
  const range = (span?: [number, number]) => (span ? (span[0] === span[1] ? `${span[0]} °C` : `${span[0]}–${span[1]} °C`) : '');

  useEffect(() => {
    const count = colours.length * countOf(spools, 1);
    onChange(colours.length ? { pick: { kind: 'filament', id: entry.id, colours, weight: Number(weight), diameter: Number(diameter), count: countOf(spools, 1) }, label: `${entry.brand} ${entry.name}`, count } : null);
  }, [entry, colours, weight, diameter, spools, onChange]);

  return (
    <>
      <Facts items={[entry.materialCode, `${entry.density} g/cm³`, entry.nozzle && `Nozzle ${range(entry.nozzle)}`, entry.bed && `Bed ${range(entry.bed)}`, entry.finish]} />
      <FormGrid>
        <SelectField label="Spool" value={weight} onChange={setWeight}>
          {entry.weights.map((w) => (
            <option key={w.g} value={w.g}>
              {w.g} g{w.spool ? ` (empty spool ${w.spool} g)` : ''}
            </option>
          ))}
        </SelectField>
        <SelectField label="Diameter" value={diameter} onChange={setDiameter}>
          {entry.diameters.map((d) => (
            <option key={d} value={d}>
              {d} mm
            </option>
          ))}
        </SelectField>
        {!preset && <NumberField label="Spools of each colour" value={spools} onChange={setSpools} inputMode="numeric" hint="Each spool is its own item, so it can be loaded into a feeder slot." />}
      </FormGrid>
      {preset && <Muted>{likely ? 'The colour closest to what the printer reports is chosen. Pick another if it is not the one.' : 'Choose the colour.'}</Muted>}
      <ChoiceChips
        label={preset ? 'Colour' : `Colours (${colours.length} of ${entry.colours.length})`}
        options={entry.colours.map(([name]) => name)}
        chosen={colours}
        // One spool is being added, so choosing a colour replaces the last choice.
        onChange={preset ? (next) => setColours(next.filter((name) => !colours.includes(name)).slice(-1)) : setColours}
        render={(name) => (
          <>
            <Swatch color={hex.get(name) ?? '#888888'} size={14} />
            {name}
          </>
        )}
      />
    </>
  );
}

function EndmillOptions({ entry, onChange }: { entry: ReferenceEndmill; onChange: OnPick }) {
  const [count, setCount] = useState('1');
  useEffect(() => {
    onChange({ pick: { kind: 'endmill', id: entry.id, count: countOf(count) }, label: entry.name, count: 1 });
  }, [entry, count, onChange]);
  return (
    <>
      <Facts items={[entry.cutType, `Ø ${fmt(entry.diameter)} mm`, `Shank ${fmt(entry.shank)} mm`, entry.angle ? `${entry.angle}°` : '', entry.cutType === 'Drill' ? '' : plural(entry.flutes, 'flute'), entry.toolMaterial, entry.coating, entry.ratedFor]} />
      <FormGrid>
        <NumberField label="How many in stock" value={count} onChange={setCount} inputMode="numeric" suffix="pcs" />
      </FormGrid>
      <Muted>Set the expected tool life on the item afterwards to get wear warnings.</Muted>
    </>
  );
}

function FastenerOptions({ entry, onChange }: { entry: ReferenceFastener; onChange: OnPick }) {
  const [material, setMaterial] = useState('0');
  const [size, setSize] = useState(entry.sizes.find((s) => s.size === 'M3')?.size ?? entry.sizes[0].size);
  const [lengths, setLengths] = useState<number[]>([]);
  const [count, setCount] = useState('0');
  const current = entry.sizes.find((s) => s.size === size) ?? entry.sizes[0];

  useEffect(() => {
    const rows = current.lengths.length ? lengths.length : 1;
    onChange(rows ? { pick: { kind: 'fastener', id: entry.id, size, lengths, material: Number(material), count: countOf(count) }, label: `${size} ${entry.name.toLowerCase()}`, count: rows } : null);
  }, [entry, current, size, lengths, material, count, onChange]);

  return (
    <>
      <Facts items={[entry.standard, entry.head && `${entry.head} head`, entry.drive, current.pitch ? `Pitch ${current.pitch} mm` : null]} />
      <FormGrid>
        <SelectField label="Material" value={material} onChange={setMaterial}>
          {entry.materials.map((m, index) => (
            <option key={`${m.material}-${m.grade}`} value={index}>
              {[m.material, m.grade].filter(Boolean).join(', ')}
            </option>
          ))}
        </SelectField>
        <NumberField label={current.lengths.length ? 'How many of each length' : 'How many'} value={count} onChange={setCount} inputMode="numeric" suffix="pcs" hint="Leave at 0 to track them before you count them." />
      </FormGrid>
      <div className={styles.choice}>
        <strong>Size</strong>
        <div className={styles.chipWrap} role="group" aria-label="Size">
          {entry.sizes.map((s) => (
            <Chip key={s.size} active={s.size === size} onClick={() => { setSize(s.size); setLengths([]); }}>
              {s.size}
            </Chip>
          ))}
        </div>
      </div>
      {current.lengths.length > 0 && (
        <ChoiceChips label="Lengths" options={current.lengths} chosen={lengths} onChange={setLengths} render={(l) => (entry.imperial ? inchLabel(l) : `${fmt(l)} mm`)} />
      )}
    </>
  );
}

function SheetOptions({ entry, sizes, onChange }: { entry: ReferenceSheet; sizes: ReferenceSummary['sheetSizes']; onChange: OnPick }) {
  const [thicknesses, setThicknesses] = useState<number[]>(entry.thicknesses.length === 1 ? [...entry.thicknesses] : []);
  const [size, setSize] = useState(sizes.find((s) => s.label === '600 × 400')?.label ?? sizes[0]?.label ?? 'custom');
  const [width, setWidth] = useState('600');
  const [length, setLength] = useState('400');
  const [count, setCount] = useState('0');
  const preset = sizes.find((s) => s.label === size);
  const w = preset?.width ?? parseNumber(width) ?? 0;
  const l = preset?.length ?? parseNumber(length) ?? 0;

  useEffect(() => {
    onChange(thicknesses.length && w > 0 && l > 0 ? { pick: { kind: 'sheet', id: entry.id, thicknesses, width: w, length: l, count: countOf(count) }, label: entry.name, count: thicknesses.length } : null);
  }, [entry, thicknesses, w, l, count, onChange]);

  return (
    <>
      {entry.note && <p className={styles.note}>{entry.note}</p>}
      <ChoiceChips label="Thicknesses" options={entry.thicknesses} chosen={thicknesses} onChange={setThicknesses} render={(t) => `${fmt(t)} mm`} />
      <FormGrid>
        <SelectField label="Sheet size" value={size} onChange={setSize}>
          {sizes.map((s) => (
            <option key={s.label} value={s.label}>
              {s.label} mm
            </option>
          ))}
          <option value="custom">Other size…</option>
        </SelectField>
        {!preset && <NumberField label="Width" value={width} onChange={setWidth} suffix="mm" />}
        {!preset && <NumberField label="Length" value={length} onChange={setLength} suffix="mm" />}
        <NumberField label="Sheets of each" value={count} onChange={setCount} inputMode="numeric" />
      </FormGrid>
    </>
  );
}

function FinishOptions({ entry, onChange }: { entry: ReferenceFinish; onChange: OnPick }) {
  const [variants, setVariants] = useState<string[]>(entry.variants.length === 1 ? [entry.variants[0].label] : []);
  const [count, setCount] = useState('1');
  useEffect(() => {
    onChange(variants.length ? { pick: { kind: 'finish', id: entry.id, variants, count: countOf(count) }, label: entry.name, count: variants.length } : null);
  }, [entry, variants, count, onChange]);
  const liquid = entry.unit === 'ml';
  return (
    <>
      <Facts items={[entry.kind, entry.base && `${entry.base} based`, entry.sheen, entry.size]} />
      <ChoiceChips label={liquid ? 'Container sizes' : entry.variants.some((v) => v.grit) ? 'Grits' : 'Grades'} options={entry.variants.map((v) => v.label)} chosen={variants} onChange={setVariants} />
      <FormGrid>
        <NumberField label={liquid ? 'Containers of each' : 'How many of each'} value={count} onChange={setCount} inputMode="numeric" hint={liquid ? 'Tracked in ml, so partly used tins can be adjusted later.' : undefined} />
      </FormGrid>
    </>
  );
}

/** Where added items go. Only in a workspace, so only in add mode. */
function AddOptions({ kind, category, onChange }: { kind: ReferenceKind; category: string | null; onChange: (value: { itemTypeId: string; locationId: string }) => void }) {
  const catalog = useCatalog();
  const locations = useMemo(() => flattenLocations(catalog.locations), [catalog.locations]);
  const match = category ? catalog.types.find((t) => t.name.toLowerCase() === category.toLowerCase()) : undefined;
  const [itemTypeId, setItemTypeId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState('');
  const chosenType = itemTypeId ?? match?.id ?? '';

  useEffect(() => {
    onChange({ itemTypeId: chosenType, locationId });
  }, [chosenType, locationId, onChange]);

  return (
    <FormGrid>
      {kind !== 'machine' && (
        <SelectField label="Add to category" value={chosenType} onChange={setItemTypeId} hint="Fields and options it needs are added to the category.">
          {!match && <option value="">New category: {category}</option>}
          {catalog.types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
      )}
      {locations.length > 0 && (
        <SelectField label="Location" value={locationId} onChange={setLocationId}>
          <option value="">None</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {'  '.repeat(l.depth)}
              {l.name}
            </option>
          ))}
        </SelectField>
      )}
    </FormGrid>
  );
}

