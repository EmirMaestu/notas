'use client';

import { Modal } from './modal';
import { btn } from './ui';

/** Confirmación de una acción sin vuelta atrás: diálogo chico con botón de peligro. */
export function ConfirmDialog({
  title, body, confirmLabel, onConfirm, onCancel, pending = false,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  return (
    <Modal
      title={title} onClose={onCancel} size="sm" role="alertdialog"
      footer={(
        <>
          <span className="flex-1" />
          <button type="button" onClick={onCancel} className={`${btn.secondary} h-10 px-3.5 text-[13.5px]`}>Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={pending} className={`${btn.danger} h-10 px-[18px] text-[13.5px]`}>
            {confirmLabel}
          </button>
        </>
      )}
    >
      <p className="text-body-sm text-muted">{body}</p>
    </Modal>
  );
}
