import { useState } from 'react';
import { ItemPicker } from '@/components/items/ItemPicker';
import { Button } from '@/components/ui/Button';
import { ErrorNote, Muted } from '@/components/ui/Display';
import { FormGrid, NumberField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatQuantity, parseNumber } from '@/lib/format';
import type { Item, Job } from '@/lib/types';

interface Props {
  job: Job;
  items: Item[];
  catalog: Catalog;
  onClose: () => void;
}

/** Records material a finished job used but nobody entered, such as the sheet a laser job cut. Takes it from stock now. */
export function AddUsedMaterial({ job, items, catalog, onClose }: Props) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const [item, setItem] = useState<Item | null>(null);
  const [quantity, setQuantity] = useState('');
  const [hours, setHours] = useState('');
  const [error, setError] = useState('');

  if (!item) return <ItemPicker title={`Material used by ${job.name}`} items={items} catalog={catalog} onPick={setItem} onClose={onClose} />;

  const unit = item.unitId ? catalog.unitById.get(item.unitId) : null;
  const tracksLife = catalog.typeById.get(item.itemTypeId)?.tracksLife ?? false;
  const amount = parseNumber(quantity) ?? 0;

  const save = async () => {
    const used = Math.max(0, amount);
    const cutting = Math.max(0, parseNumber(hours) ?? 0);
    if (used <= 0 && cutting <= 0) return setError('Say how much was used.');
    setError('');
    const ok = await run(() => api.post(wsPath(`/jobs/${job.id}/usages`)!, { itemId: item.id, quantity: used, hours: cutting }), `Added ${item.name}. Stock updated.`);
    if (ok) onClose();
  };

  return (
    <Modal
      title={`Used by ${job.name}`}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={() => setItem(null)}>Change material</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Take from stock
          </Button>
        </>
      }
    >
      <p>
        <strong>{item.name}</strong> <Muted>{formatQuantity(item.quantity, unit)} in stock</Muted>
      </p>
      <FormGrid>
        <NumberField label={tracksLife ? 'Used up' : 'Quantity used'} value={quantity} onChange={setQuantity} suffix={unit?.symbol} placeholder="0" autoFocus />
        {tracksLife && <NumberField label="Cutting time" value={hours} onChange={setHours} suffix="h" placeholder="0" />}
      </FormGrid>
      {amount > item.quantity && <Muted>More than is in stock. It will take it to zero.</Muted>}
      <Muted>This takes the material from stock now and adds its cost to the job.</Muted>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  );
}
