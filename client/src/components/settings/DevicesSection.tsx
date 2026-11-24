import { useEffect, useState } from 'react';
import { CircleArrowUp, CloudDownload, Copy, Pencil, Plus, RefreshCw, Trash2, Usb, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorNote, Loading, Muted, SectionTitle } from '@/components/ui/Display';
import { Checkbox, FormGrid, SelectField, TextField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction, useOptimisticAction, useToast } from '@/components/ui/Toast';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatDateTime, locationPath } from '@/lib/format';
import { patchCached } from '@/lib/store';
import type { Device, DevicePairing } from '@/lib/types';
import { FlashDisplay } from '@/components/settings/FlashDisplay';
import styles from '@/components/settings/Settings.module.css';

type Dialog = { kind: 'add' } | { kind: 'flash' } | { kind: 'rename'; device: Device };

/** Location displays: small screens fixed to a shelf, rack or dry box that show what is stored there. */
export function DevicesSection({ catalog }: { catalog: Catalog }) {
  const { canEdit, wsPath } = useWorkspace();
  const devices = useWsQuery<Device[]>('/devices');
  const { run, busy } = useAction();
  const toast = useToast();
  const runNow = useOptimisticAction();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // A set-up code is only ever shown by the request that made it, so it lives here until the page is left.
  const [pairings, setPairings] = useState<Record<string, DevicePairing>>({});

  if (devices.error) return <ErrorNote>{devices.error}</ErrorNote>;
  if (!devices.data) return <Loading />;

  const locations = [...catalog.locations]
    .map((location) => ({ id: location.id, path: locationPath(location.id, catalog.locations) }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const remember = (device: Device) => {
    if (device.pairing) setPairings((current) => ({ ...current, [device.id]: device.pairing! }));
  };

  const update = (device: Device, change: Partial<Pick<Device, 'locationId' | 'machineId' | 'canWrite'>>, done: string) =>
    run(() => api.patch(wsPath(`/devices/${device.id}`)!, change), done);

  const newCode = (device: Device) => run(async () => remember(await api.post<Device>(wsPath(`/devices/${device.id}/pairing`)!, {})), 'New set-up code made');

  // Wrkbench looks for new firmware by itself once an hour; this looks now, after a release was just published.
  const checkFirmware = () =>
    run(async () => {
      const found = await api.post<{ version: string | null; reached: boolean }>(wsPath('/firmware/check')!, {});
      if (!found.reached) toast('Could not reach the firmware releases just now. Try again in a few minutes.', 'danger');
      else toast(found.version ? `The newest firmware is ${found.version}` : 'No firmware has been published yet');
    });

  const remove = async (device: Device) => {
    const ok = await confirm({
      title: `Remove ${device.name}?`,
      message: 'The display stops showing anything and goes back to asking for a set-up code. Nothing in the inventory changes.',
      confirmLabel: 'Remove display',
      danger: true,
    });
    if (ok) await run(() => api.delete(wsPath(`/devices/${device.id}`)!), 'Display removed');
  };

  return (
    <>
      <SectionTitle
        action={
          canEdit && (
            <div className={styles.danger}>
              <Button size="sm" icon={CloudDownload} onClick={checkFirmware} disabled={busy}>
                Check for new firmware
              </Button>
              <Button size="sm" icon={Usb} onClick={() => setDialog({ kind: 'flash' })}>
                Flash a new display
              </Button>
              <Button size="sm" icon={Plus} onClick={() => setDialog({ kind: 'add' })}>
                Add display
              </Button>
            </div>
          )
        }
      >
        Location displays
      </SectionTitle>
      <Muted>
        A small touch screen (a CYD board) fixed to a shelf, rack or dry box. It shows what is stored there and how much is left, with low stock at the
        top, and updates by itself. With a tag reader fitted, tapping a spool's sticker on it shows the spool and can put it away there or mark it for
        the printer beside it.
      </Muted>

      {devices.data.length === 0 && (
        <div className={styles.general}>
          <Muted>No display yet. {canEdit ? 'Add one to get a set-up code to type into it.' : 'An admin or owner can add one.'}</Muted>
        </div>
      )}

      {devices.data.map((device) => {
        const pairing = pairings[device.id];
        return (
          <div key={device.id} className={styles.general}>
            <div className={styles.bridgeHead}>
              <div className={styles.memberText}>
                <strong>{device.name}</strong>
                <Muted>
                  {device.paired
                    ? [
                        !device.online && `Last seen ${device.lastSeenAt ? formatDateTime(device.lastSeenAt) : 'never'}`,
                        device.version && `firmware ${device.version}`,
                        device.hasReader ? 'tag reader connected' : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'Waiting for its set-up code'}
                </Muted>
              </div>
              <Badge tone={device.online ? 'ok' : device.paired ? 'warn' : 'neutral'}>{device.online ? 'Connected' : device.paired ? 'Offline' : 'Not set up'}</Badge>
            </div>

            {pairing && !device.online && <PairingBox pairing={pairing} />}
            {!pairing && !device.paired && canEdit && <Muted>The set-up code is only shown once. Make a new code to see it again.</Muted>}
            {device.paired && !device.online && !pairing && (
              <Muted>Check that it has power and is in reach of the Wi-Fi. If it was reset, make a new set-up code and type it in on the display.</Muted>
            )}

            {device.paired && <FirmwareLine device={device} canEdit={canEdit} />}

            <FormGrid>
              <SelectField
                label="Shows"
                value={device.locationId ?? ''}
                onChange={(value) => update(device, { locationId: value || null }, 'Location changed')}
                disabled={!canEdit || busy}
                hint="Items in this location and the ones inside it."
              >
                <option value="">No location yet</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.path}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Printer beside it"
                value={device.machineId ?? ''}
                onChange={(value) => update(device, { machineId: value || null }, 'Printer changed')}
                disabled={!canEdit || busy}
                hint="For “going into the printer” when a spool is tapped."
              >
                <option value="">None</option>
                {catalog.machines.map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.name}
                  </option>
                ))}
              </SelectField>
            </FormGrid>
            <Checkbox
              label="Allow changes from this display"
              hint="Tapping a tag may put the spool away here, mark it for the printer, or link a new sticker. Off: the display only shows things."
              checked={device.canWrite}
              disabled={!canEdit || busy}
              onChange={(canWrite) =>
                // A switch: it flips at once and flips back if the save fails.
                runNow(
                  () => patchCached<Device[]>(wsPath('/devices')!, (all) => all.map((other) => (other.id === device.id ? { ...other, canWrite } : other))),
                  () => api.patch(wsPath(`/devices/${device.id}`)!, { canWrite }),
                )
              }
            />

            {canEdit && (
              <div className={styles.danger}>
                <Button icon={Pencil} onClick={() => setDialog({ kind: 'rename', device })} disabled={busy}>
                  Rename
                </Button>
                <Button icon={RefreshCw} onClick={() => newCode(device)} disabled={busy}>
                  New set-up code
                </Button>
                <Button variant="danger" icon={Trash2} onClick={() => remove(device)} disabled={busy}>
                  Remove
                </Button>
              </div>
            )}
          </div>
        );
      })}

      <Muted>
        A display can read the items of this workspace and, while changes are allowed, move a tapped spool, mark it for a printer and link stickers.
        It cannot change amounts or anything else. Removing it here stops it at once.
      </Muted>

      {dialog?.kind === 'flash' && <FlashDisplay locations={locations} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'add' && <AddForm locations={locations} onClose={() => setDialog(null)} onCreated={remember} />}
      {dialog?.kind === 'rename' && <RenameForm device={dialog.device} onClose={() => setDialog(null)} />}
    </>
  );
}

/**
 * Newer firmware for a display, and its update while it runs. The display fetches it on its next poll, restarts
 * on it and reports the new version, so this follows from the device list refreshing by itself.
 */
function FirmwareLine({ device, canEdit }: { device: Device; canEdit: boolean }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const { firmware } = device;

  if (device.updateTo) {
    return (
      <div className={styles.danger}>
        <Muted>
          Installing firmware {device.updateTo}. The display downloads it within half a minute, restarts and shows its screen again; this takes a minute or two.
          {!device.online && ' It is offline just now, so it starts once it is back.'}
        </Muted>
        {canEdit && (
          <Button size="sm" icon={X} onClick={() => run(() => api.delete(wsPath(`/devices/${device.id}/update`)!), 'Update withdrawn')} disabled={busy}>
            Stop waiting
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      {device.updateError && <Muted>The last firmware update did not finish: {device.updateError}. The display kept its firmware {device.version}.</Muted>}
      {firmware.updateAvailable && firmware.latest && (
        <div className={styles.danger}>
          <Muted>
            Firmware {firmware.latest} is available{device.version ? `; this display runs ${device.version}` : ''}.{' '}
            {firmware.blocked ? `${firmware.blocked}.` : !device.online ? 'Update it once it is back online.' : ''}
          </Muted>
          {canEdit && !firmware.blocked && (
            <Button
              size="sm"
              icon={CircleArrowUp}
              onClick={() => run(() => api.post(wsPath(`/devices/${device.id}/update`)!, {}), 'Update started')}
              disabled={busy || !device.online}
            >
              Update to {firmware.latest}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function PairingBox({ pairing }: { pairing: DevicePairing }) {
  const toast = useToast();
  const [, tick] = useState(0);
  // Re-render each half minute so the countdown and the "run out" note stay true.
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const minutes = Math.ceil((new Date(pairing.expiresAt).getTime() - Date.now()) / 60_000);
  const local = /\/\/(localhost|127\.|\[::1\])/.test(pairing.server);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pairing.server);
      toast('Address copied');
    } catch {
      toast('Could not copy. Select the address and copy it by hand.', 'danger');
    }
  };

  if (minutes <= 0) return <Muted>That set-up code has run out. Make a new one.</Muted>;
  return (
    <>
      <Muted>
        1. Power the display. With no Wi-Fi saved it shows a network called Wrkbench-…; join it from your phone and a set-up page opens.
        <br />
        2. Choose your Wi-Fi, and enter this server's address and the code below.
        <br />
        3. Save. The display joins the Wi-Fi and shows this location within a minute. The code works once, for the next {minutes} minute
        {minutes === 1 ? '' : 's'}.
      </Muted>
      <div className={styles.command}>
        <code className={styles.commandText}>{pairing.server}</code>
        <Button icon={Copy} onClick={copy}>
          Copy
        </Button>
      </div>
      {local && (
        <Muted>
          This address only works on this computer. Use the address other devices on your network reach it at, such as http://192.168.1.20:4000, or set
          APP_URL on the server.
        </Muted>
      )}
      <div className={styles.command}>
        <span className={styles.pairCode}>{pairing.code}</span>
      </div>
    </>
  );
}

function AddForm({ locations, onClose, onCreated }: { locations: Array<{ id: string; path: string }>; onClose: () => void; onCreated: (device: Device) => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');

  const save = async () => {
    const ok = await run(async () => onCreated(await api.post<Device>(wsPath('/devices')!, { name, locationId: locationId || null })), 'Display added');
    if (ok) onClose();
  };

  return (
    <Modal
      title="Add a display"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            Add and show set-up code
          </Button>
        </>
      }
    >
      <FormGrid>
        <TextField label="Name" value={name} onChange={setName} placeholder="Rack A display" hint="Where it hangs, so you can tell displays apart." autoFocus maxLength={80} />
        <SelectField label="Shows" value={locationId} onChange={setLocationId} hint="You can change this at any time.">
          <option value="">Choose later</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.path}
            </option>
          ))}
        </SelectField>
      </FormGrid>
    </Modal>
  );
}

function RenameForm({ device, onClose }: { device: Device; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const [name, setName] = useState(device.name);

  const save = async () => {
    const ok = await run(() => api.patch(wsPath(`/devices/${device.id}`)!, { name }), 'Display renamed');
    if (ok) onClose();
  };

  return (
    <Modal
      title={`Rename ${device.name}`}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={setName} autoFocus maxLength={80} />
    </Modal>
  );
}
