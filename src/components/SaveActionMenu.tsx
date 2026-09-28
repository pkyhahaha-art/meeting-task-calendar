export function SaveActionMenu({ busy, onSave }: { busy: boolean; onSave: (notifyRecipients: boolean) => void }) {
  return <div className="flex flex-wrap gap-2">
    <button type="button" className="btn-primary" disabled={busy} onClick={() => onSave(false)}>บันทึกการแก้ไข</button>
    <button type="button" className="btn-secondary" disabled={busy} onClick={() => onSave(true)}>บันทึกและแจ้งเตือน</button>
  </div>
}
