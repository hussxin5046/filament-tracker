import type { Appearance } from '@/lib/themes';

export type Role = 'owner' | 'admin' | 'operator' | 'viewer';
export type FieldValue = string | number | boolean | null;
export type FieldType = 'text' | 'number' | 'select' | 'boolean' | 'color' | 'date';
export type MachineStatus = 'ready' | 'in_use' | 'needs_service' | 'offline';
export type JobStatus = 'planned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type DueStatus = 'ok' | 'soon' | 'overdue';

export interface User {
  id: string;
  email: string;
  name: string;
  /** A try-it-out session: no email or password yet, removed after a week unless it registers. */
  isGuest: boolean;
  /** False while a registered account has not opened its confirmation link. Missing from an older server: treat as confirmed. */
  emailVerified?: boolean;
  /** Whether signing in also asks for a code from an authenticator app. Missing from an older server: it does not. */
  twoStep?: boolean;
  /** Personal theme. Missing from an older server: treat as the default. */
  appearance?: Appearance;
  /** Personal navigation layout as saved; null or missing for the standard one. Read it through normalizeLayout. */
  navigation?: unknown;
  /** Whether the daily report opens by itself on the first visit of the day. Missing from an older server: it does. */
  dailyReportAuto?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  currency: string;
  /** Profit wanted on a project, as a percentage of its price. Used to recommend a price. */
  targetMargin: number;
  role: Role;
  counts?: { items: number; machines: number; members: number };
}

export interface Member {
  id: string;
  role: Role;
  userId: string;
  name: string;
  email: string;
}

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface Supplier {
  id: string;
  name: string;
  website: string;
  email: string;
  notes: string;
}

export interface Location {
  id: string;
  name: string;
  kind: string;
  code: string;
  parentId: string | null;
}

export interface CustomField {
  id?: string;
  key: string;
  label: string;
  fieldType: FieldType;
  unit: string;
  options: string[];
  required: boolean;
  showInList: boolean;
  isSizeDimension: boolean;
}

export interface ItemType {
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultUnitId: string | null;
  tracksLife: boolean;
  sortOrder: number;
  fields: CustomField[];
  _count?: { items: number };
}

export interface Item {
  id: string;
  itemTypeId: string;
  name: string;
  sku: string;
  quantity: number;
  capacity: number | null;
  minQuantity: number;
  unitCost: number;
  unitId: string | null;
  supplierId: string | null;
  locationId: string | null;
  notes: string;
  fields: Record<string, FieldValue>;
  usageHours: number;
  lifeHours: number | null;
  wearFlag: boolean;
  isRemnant: boolean;
  parentId: string | null;
  /** The id on the spool's own tag, as a connected printer read it. */
  tagId: string | null;
  /** When it was taken out at a location display's reader; set while the spool is "on the move". */
  outSince: string | null;
  compatibleMachineIds: string[];
  slot: { position: number; label: string; subUnit: { id: string; name: string; machineId: string | null } } | null;
  updatedAt: string;
}

export interface Movement {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  note: string;
  createdAt: string;
  user: { name: string } | null;
  job: { id: string; name: string } | null;
}

export interface MachineType {
  id: string;
  name: string;
  icon: string;
}

export interface Machine {
  id: string;
  machineTypeId: string | null;
  name: string;
  manufacturer: string;
  model: string;
  serial: string;
  status: MachineStatus;
  usageHours: number;
  hourlyCost: number;
  locationId: string | null;
  notes: string;
  /** Fixed specifications such as build volume or laser power, shown at a glance. */
  specs: Reading[];
  compatibleItemIds: string[];
}

export interface Reading {
  label: string;
  value: string;
  unit: string;
}

/** What a connected printer last saw in a slot. */
export interface Detected {
  state: 'empty' | 'loaded';
  material: string | null;
  subType: string | null;
  colour: string | null;
  colours: string[];
  brand: string | null;
  tagId: string | null;
  remainingPercent: number | null;
  spoolWeightGrams: number | null;
  /** Nozzle temperature range the printer has for it; missing on readings saved by older versions. */
  nozzleTemp?: [number, number] | null;
  diameter?: number | null;
}

export interface Slot {
  id: string;
  position: number;
  label: string;
  itemId: string | null;
  /** Null for slots no printer reports. */
  detected: Detected | null;
  /** Who put the item here: a member, or the printer recognising its tag. */
  source: 'manual' | 'printer';
}

export interface SubUnit {
  id: string;
  machineId: string | null;
  name: string;
  kind: string;
  readings: Reading[];
  statusNote: string;
  /** Set while a connected printer reports this unit and keeps its slots and readings. */
  externalId: string | null;
  slots: Slot[];
}

export interface MaintenanceTask {
  id: string;
  name: string;
  description: string;
  machineId: string | null;
  machineTypeId: string | null;
  intervalDays: number | null;
  intervalHours: number | null;
  active: boolean;
}

export interface ScheduleEntry {
  taskId: string;
  taskName: string;
  description: string;
  machineId: string;
  machineName: string;
  inherited: boolean;
  intervalDays: number | null;
  intervalHours: number | null;
  status: DueStatus;
  lastDoneAt: string | null;
  lastDoneHours: number | null;
  dueDate: string | null;
  daysRemaining: number | null;
  hoursRemaining: number | null;
  progress: number;
}

export interface MaintenanceData {
  tasks: MaintenanceTask[];
  schedule: ScheduleEntry[];
}

export interface MaintenanceLog {
  id: string;
  machineId: string;
  performedAt: string;
  hoursAtService: number;
  notes: string;
  task: { name: string };
  machine: { name: string };
  user: { name: string } | null;
  parts: Array<{ id: string; quantity: number; item: { name: string } }>;
}

export interface JobUsage {
  id: string;
  itemId: string;
  quantity: number;
  hours: number;
  cost: number;
  item: { id: string; name: string; unitCost: number; lifeHours: number | null; quantity: number; unitId: string | null; itemTypeId: string };
}

export interface Job {
  id: string;
  machineId: string | null;
  name: string;
  status: JobStatus;
  durationHours: number;
  notes: string;
  extraCost: number;
  materialCost: number;
  toolingCost: number;
  machineCost: number;
  totalCost: number;
  /** -1 low, 0 normal, 1 high, 2 urgent. */
  priority: number;
  queuePosition: number;
  startedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  machine: { id: string; name: string; hourlyCost: number } | null;
  createdBy: { name: string } | null;
  /** The project this job is part of, if any. */
  project: { id: string; name: string } | null;
  /** "printer" when a connected printer was seen starting the print and made the job itself. */
  source: 'manual' | 'printer';
  /** Why it failed, when a connected printer said. */
  failureReason: string;
  usages: JobUsage[];
  /** Set when the job came from an approved outside request. */
  request: { id: string; requesterName: string; requesterEmail: string; files: RequestFile[] } | null;
}

export type ProjectStage = 'open' | 'invoiced' | 'paid';

export interface ProjectTotals {
  /** What the project's jobs cost, including the estimate of any job still open. */
  cost: number;
  /** True while a job is still open, so the cost can still move. */
  estimated: boolean;
  /** The target margin in use: the project's own, or the workspace's. */
  marginPercent: number;
  recommendedPrice: number;
  price: number | null;
  /** Price less cost. Null until a price is set. */
  profit: number | null;
  /** Profit as a percentage of the price. */
  profitMargin: number | null;
}

/** Jobs done for one piece of work, with what they cost against the price invoiced. */
export interface Project {
  id: string;
  name: string;
  customer: string;
  notes: string;
  stage: ProjectStage;
  price: number | null;
  /** This project's own target margin. Null uses the workspace's. */
  marginPercent: number | null;
  createdAt: string;
  jobs: Array<{ id: string; name: string; status: JobStatus; totalCost: number; completedAt: string | null; machine: { id: string; name: string } | null }>;
  totals: ProjectTotals;
}

export type RequestStatus = 'pending' | 'changes_requested' | 'approved' | 'in_progress' | 'done' | 'rejected';

export interface RequestComment {
  id: string;
  authorName: string;
  fromRequester: boolean;
  body: string;
  createdAt: string;
}

export interface RequestFile {
  id: string;
  name: string;
  size: number;
}

/** A job someone outside the workspace asked for, with the files they sent for checking. */
export interface JobRequest {
  id: string;
  title: string;
  details: string;
  requesterName: string;
  requesterEmail: string;
  status: RequestStatus;
  reviewNote: string;
  reviewedAt: string | null;
  createdAt: string;
  /** Only sent to editors and owners, so they can pass the progress link on. */
  trackToken?: string;
  machine: { id: string; name: string } | null;
  job: { id: string; name: string; status: JobStatus } | null;
  reviewedBy: { name: string } | null;
  files: RequestFile[];
  comments: RequestComment[];
}

export interface UploadLimits {
  maxFiles: number;
  maxMb: number;
  extensions: string[];
}

export interface RequestLink {
  enabled: boolean;
  /** Null for viewers and while the link is off. */
  token: string | null;
  limits: UploadLimits;
}

/** What the public submission page is told about a workspace. */
export interface SubmitInfo {
  workspaceName: string;
  machines: Array<{ id: string; name: string; type: string }>;
  limits: UploadLimits;
}

/** What a requester sees when following their request. */
export interface TrackedRequest {
  workspaceName: string;
  title: string;
  details: string;
  requesterName: string;
  status: RequestStatus;
  reviewNote: string;
  createdAt: string;
  reviewedAt: string | null;
  machineName: string | null;
  jobStatus: JobStatus | null;
  /** Requests still waiting that were sent before this one. */
  ahead: number;
  /** Where the job made from it stands in its machine's queue, while it is open. */
  estimate: { ahead: number; estimatedStart: string | null; estimatedFinish: string | null; paused: boolean } | null;
  comments: RequestComment[];
  files: Array<{ name: string; size: number }>;
  limits: UploadLimits;
}

/** One entry of the workspace's activity log. */
export interface Activity {
  id: string;
  userId: string | null;
  userName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
  undoneAt: string | null;
  /** True when this viewer may undo it now. */
  undoable: boolean;
}

export interface QueuedJob {
  id: string;
  name: string;
  status: JobStatus;
  priority: number;
  queuePosition: number;
  durationHours: number;
  startedAt: string | null;
  createdAt: string;
  remainingHours: number;
  estimatedStart: string | null;
  estimatedFinish: string | null;
  requesterName: string | null;
}

/** A machine's open jobs in run order. machine is null for jobs not on a machine yet. */
export interface MachineQueue {
  machine: { id: string; name: string; status: MachineStatus } | null;
  paused: boolean;
  unestimated: number;
  totalHours: number;
  clearsAt: string | null;
  jobs: QueuedJob[];
}

export interface Dashboard {
  counts: { items: number; machines: number; openJobs: number; lowStock: number; wornTools: number; overdue: number; dueSoon: number };
  stockValue: number;
  month: { jobs: number; cost: number; hours: number };
  lowStock: Array<{ id: string; name: string; quantity: number; minQuantity: number; unitId: string | null; itemTypeId: string }>;
  wornTools: Array<{ id: string; name: string; usageHours: number; lifeHours: number | null; wearFlag: boolean }>;
  maintenance: ScheduleEntry[];
  machines: Array<{ id: string; name: string; status: MachineStatus; usageHours: number }>;
  recentJobs: Array<{ id: string; name: string; status: JobStatus; totalCost: number; durationHours: number; createdAt: string; completedAt: string | null; machine: { name: string } | null }>;
}

export interface ReorderLine {
  itemId: string;
  name: string;
  typeName: string;
  reason: 'low' | 'worn';
  quantity: number;
  minQuantity: number;
  unit: string;
  decimals: number;
  suggested: number;
  estimatedCost: number;
}

export interface ReorderData {
  groups: Array<{ supplier: { id: string; name: string; website: string; email: string } | null; lines: ReorderLine[]; total: number }>;
  total: number;
}

interface ReportAmount {
  unit: string;
  decimals: number;
}

/** One line of the daily action plan. The server states the facts; `describeAction` words them. */
export type ReportAction =
  | { kind: 'service'; urgency: 'today' | 'soon'; machineId: string; machineName: string; entries: ScheduleEntry[] }
  | { kind: 'machine'; urgency: 'today'; machineId: string; machineName: string }
  | ({ kind: 'shortfall'; urgency: 'today'; itemId: string; itemName: string; needed: number; available: number; jobs: string[] } & ReportAmount)
  | { kind: 'requests'; urgency: 'today'; count: number; oldestAt: string }
  | { kind: 'order'; urgency: 'today'; suppliers: string[]; items: string[]; unassigned: number; estimatedCost: number }
  | ({ kind: 'runout'; urgency: 'soon'; itemId: string; itemName: string; quantity: number; minQuantity: number; daysLeft: number } & ReportAmount)
  | { kind: 'wearing'; urgency: 'soon'; itemId: string; itemName: string; usageHours: number; lifeHours: number };

export interface ReportTotals {
  jobs: number;
  failed: number;
  hours: number;
  cost: number;
}

/** Shown on the first visit of each day: what to do, in order, and how the last week went. */
export interface DailyReport {
  generatedAt: string;
  actions: ReportAction[];
  /** Finished jobs over the last 24 hours, the last 7 days, and the 7 days before that. */
  activity: { day: ReportTotals; week: ReportTotals; previousWeek: ReportTotals };
  openJobs: { planned: number; inProgress: number };
  /** Last 30 days. */
  failures: { failed: number; total: number; machine: { name: string; failed: number } | null };
  busiestMachine: { name: string; hours: number } | null;
  /** Last 30 days, biggest spend first. */
  mostUsed: Array<{ itemId: string; name: string; used: number; cost: number; daysLeft: number | null } & ReportAmount>;
}

/** Portable workspace description. Only the parts the client edits are typed closely. */
export interface Snapshot {
  version: 1;
  workspace?: { name: string; description: string; currency: string };
  units: Array<{ ref: string; name: string; symbol: string }>;
  suppliers: unknown[];
  locations: unknown[];
  itemTypes: Array<{ ref: string; name: string; icon: string; color: string; fields: CustomField[] }>;
  machineTypes: Array<{ ref: string; name: string; icon: string }>;
  machines: Array<{ ref: string; name: string }>;
  items: unknown[];
  subUnits: unknown[];
  maintenanceTasks: Array<{ ref: string; name: string; machine?: string | null; machineType?: string | null; intervalDays?: number | null; intervalHours?: number | null }>;
  projects?: unknown[];
  jobs: unknown[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  sampleData: boolean;
  counts: { itemTypes: number; machineTypes: number; maintenanceTasks: number; machines: number; items: number };
}

export interface Template extends Omit<TemplateSummary, 'counts'> {
  snapshot: Snapshot;
}

// ---- Connected printers -------------------------------------------------------------
// PrinterState mirrors server/src/integrations/types.ts.

export interface Pairing {
  code: string;
  expiresAt: string;
  /** Copy-paste commands that run the bridge with this code. */
  docker: string;
  source: string;
}

export interface Bridge {
  id: string;
  name: string;
  version: string;
  platform: string;
  lastSeenAt: string | null;
  createdAt: string;
  online: boolean;
  /** False until its set-up code has been used. */
  paired: boolean;
  pairingExpiresAt: string | null;
  printerCount: number;
  /** Only in the answer to creating a bridge or asking for a new code. */
  pairing?: Pairing;
}

export interface DevicePairing {
  code: string;
  expiresAt: string;
  /** The address the display is told to reach this server at. */
  server: string;
}

/** A location display: a small screen on a shelf that shows what is stored there. */
export interface Device {
  id: string;
  name: string;
  kind: string;
  locationId: string | null;
  locationName: string | null;
  /** The printer it sits beside, for "this spool goes in next" from a tapped tag. */
  machineId: string | null;
  machineName: string | null;
  /** Whether tapping a tag on it may move items, mark a spool for the printer or link a tag. */
  canWrite: boolean;
  model: string;
  version: string;
  hasReader: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  online: boolean;
  paired: boolean;
  pairingExpiresAt: string | null;
  /** The firmware version it was asked to install, until it reports running it or the update fails. */
  updateTo: string | null;
  /** Why the last update did not finish. */
  updateError: string | null;
  /** The newest published firmware for its board, and whether it can be updated from Settings. */
  firmware: {
    latest: string | null;
    updateAvailable: boolean;
    /** Why it cannot be updated from here, when it cannot. */
    blocked: string | null;
  };
  /** Only in the answer to adding a display or asking for a new code. */
  pairing?: DevicePairing;
}

/** A Bambu Lab spool tapped on a location display that nothing in stock is tied to yet. */
export interface UnknownTag {
  id: string;
  tagId: string;
  detected: Detected;
  createdAt: string;
  device: { name: string; locationId: string | null } | null;
}

export interface PrinterLink {
  id: string;
  machineId: string;
  bridgeId: string;
  vendor: string;
  serial: string;
  host: string;
  modelName: string;
  firmware: string;
  codeState: 'ok' | 'missing' | 'rejected';
  machine: { name: string };
  bridge: { name: string };
}

export interface DiscoveredPrinter {
  serial: string;
  host: string;
  name: string;
  modelName: string;
  linked: boolean;
}

export type PrinterConnection = 'live' | 'printer_unreachable' | 'bridge_offline' | 'needs_code' | 'never_seen';
export type PrinterPhase = 'idle' | 'preparing' | 'printing' | 'paused' | 'finished' | 'failed' | 'unknown';

export interface PrinterTemp {
  current: number | null;
  target: number | null;
}

export interface PrinterTray extends Detected {
  /** 1-based, the same as Slot.position. */
  position: number;
  active: boolean;
}

export interface PrinterFeeder {
  key: string;
  kind: 'ams' | 'ams_lite' | 'ams_2_pro' | 'ams_ht' | 'external';
  label: string;
  kindLabel: string;
  humidityPercent: number | null;
  humidityLevel: number | null;
  temperature: number | null;
  drying: { remainingMinutes: number | null; targetTemp?: number | null; filament?: string | null } | null;
  trays: PrinterTray[];
}

export interface PrinterError {
  kind: 'hms' | 'print_error';
  code: string;
  severity: 'info' | 'warning' | 'error' | 'fatal';
  message: string | null;
  url: string | null;
}

export interface PrinterState {
  machineId: string;
  printerLinkId: string;
  connection: PrinterConnection;
  asOf: number | null;
  endsAt: number | null;
  /** The print on the printer's screen, when the server holds the slicer's picture of it. Absent from older servers. */
  thumbnailRunId?: string | null;
  phase: PrinterPhase;
  rawState: string;
  print: { name: string | null; kind?: 'print' | 'laser'; progress: number | null; layer: number | null; totalLayers: number | null; remainingMinutes: number | null } | null;
  /** A tool fitted in place of printing ("Laser 40W"); missing on readings saved by older versions. */
  tool?: string | null;
  bed: PrinterTemp | null;
  chamber: PrinterTemp | null;
  /** `active`: the nozzle printing now; missing on readings saved by older versions. */
  extruders: Array<{ label: string; temp: PrinterTemp | null; nozzle: { diameter: number | null; type: string | null }; active?: boolean }>;
  feeders: PrinterFeeder[];
  errors: PrinterError[];
  wifiSignal: number | null;
  firmware: string | null;
  modelName: string | null;
}

/** A spool scanned to go into a printer next, as told over the socket ("printer:pending-spool"). */
export interface PendingSpoolEvent {
  machineId: string;
  itemId: string;
  itemName: string;
  state: 'armed' | 'linked' | 'dropped' | 'expired' | 'cancelled';
  /** ms since epoch when the wait ends (armed only). */
  expiresAt?: number;
  /** Where it went (linked only), e.g. "AMS 1 slot 2". */
  place?: string;
  /** Linked, though the printer describes the tray as a different filament. */
  mismatch?: boolean;
  reason?: 'several' | 'gone';
}

/** GET /ai/status: whether the assistant is on for this server, and what is left of today's questions. */
export interface AiStatus {
  enabled: boolean;
  paused?: boolean;
  pausedUntil?: string;
  questionsPerDay?: number;
  questionsLeft?: number;
  /** Owners only: what this workspace has spent on it this month, in US dollars. */
  workspaceSpendUsd?: number;
}

/** Where an item is, and whether a location display was asked to light it up (POST /items/:id/find). */
export interface FindAnswer {
  state: 'lit' | 'offline' | 'no-display' | 'loaded' | 'on-the-move' | 'nowhere';
  /** A location's path, or "X1C, AMS 1 slot 2". */
  place: string | null;
  /** The displays asked to light it. `outdated`: its firmware is too old to show it. */
  displays: Array<{ name: string; online: boolean; outdated: boolean }>;
  /** When the displays stop lighting it, in milliseconds (lit and offline only). */
  expiresAt: number | null;
}
