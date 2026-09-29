import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import Swal from 'sweetalert2'
import { useLanguage } from '../i18n/LanguageProvider'

export function SaveActionMenu({ busy, onSave, onComplete }: { busy: boolean; onSave: (notifyRecipients: boolean) => Promise<boolean>; onComplete: () => void }) {
  const { text } = useLanguage()
  const [savingWithNotification, setSavingWithNotification] = useState<boolean | null>(null)
  const saving = savingWithNotification !== null

  const confirmSave = async () => {
    if (busy || saving) return
    const result = await Swal.fire({
      icon: 'question',
      title: text('ยืนยันการบันทึก Meeting', 'Confirm meeting update'),
      text: text('เลือกวิธีการบันทึกที่ต้องการ', 'Choose how to save your changes.'),
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: text('บันทึกการแก้ไข', 'Save changes'),
      denyButtonText: text('บันทึกการแก้ไขและแจ้งเตือน', 'Save and notify'),
      cancelButtonText: text('ยกเลิก', 'Cancel'),
      confirmButtonColor: '#0f766e',
      denyButtonColor: '#b45309',
    })
    if (!result.isConfirmed && !result.isDenied) return
    const notifyRecipients = result.isDenied
    setSavingWithNotification(notifyRecipients)
    let completed = false
    try {
      if (!await onSave(notifyRecipients)) return
      await Swal.fire({
        icon: 'success',
        title: text('สำเร็จ', 'Success'),
        text: notifyRecipients ? text('บันทึกการแก้ไขและแจ้งเตือนผู้รับแล้ว', 'Changes saved and recipients notified.') : text('บันทึกการแก้ไขเรียบร้อยแล้ว', 'Changes saved.'),
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
      })
      completed = true
    } finally {
      setSavingWithNotification(null)
    }
    if (completed) onComplete()
  }

  return <div className="flex flex-wrap gap-2">
    <button type="button" className="btn-primary" disabled={busy || saving} onClick={() => void confirmSave()}>{saving && <Loader2 className="animate-spin" size={17} />}{text('บันทึก', 'Save')}</button>
  </div>
}
