import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import Swal from 'sweetalert2'
import { useLanguage } from '../i18n/LanguageProvider'

export function SaveActionMenu({ busy, onSave, onComplete, allowNotification = true, disabled = false }: { busy: boolean; onSave: (notifyRecipients: boolean) => Promise<boolean>; onComplete: () => void; allowNotification?: boolean; disabled?: boolean }) {
  const { text } = useLanguage()
  const [savingWithNotification, setSavingWithNotification] = useState<boolean | null>(null)
  const saving = savingWithNotification !== null

  const confirmSave = async () => {
    if (busy || saving || disabled) return
    const result = await Swal.fire({
      icon: 'question',
      title: text('ยืนยันการบันทึก Meeting', 'Confirm meeting update'),
      text: allowNotification ? text('เลือกวิธีการบันทึกที่ต้องการ', 'Choose how to save your changes.') : text('การแก้ไขนี้จะใช้กับการแจ้งเตือนตามกำหนดนัด', 'These changes will be used for the scheduled appointment reminder.'),
      showCancelButton: true,
      showDenyButton: allowNotification,
      confirmButtonText: text('บันทึกการแก้ไข', 'Save changes'),
      denyButtonText: text('บันทึกการแก้ไขและแจ้งเตือน', 'Save and notify'),
      cancelButtonText: text('ยกเลิก', 'Cancel'),
      confirmButtonColor: '#0f766e',
      denyButtonColor: '#b45309',
    })
    if (!result.isConfirmed && !result.isDenied) return
    const notifyRecipients = allowNotification && result.isDenied
    setSavingWithNotification(notifyRecipients)
    let completed = false
    try {
      if (!await onSave(notifyRecipients)) return
      await Swal.fire({
        icon: 'success',
        title: text('สำเร็จ', 'Success'),
        text: notifyRecipients ? text('บันทึกการแก้ไขและแจ้งเตือนผู้รับแล้ว', 'Changes saved and recipients notified.') : allowNotification ? text('บันทึกการแก้ไขเรียบร้อยแล้ว', 'Changes saved.') : text('บันทึกการแก้ไขเฉพาะนัดแล้ว', 'Changes for this occurrence have been saved.'),
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
    <button type="button" className="btn-primary" disabled={busy || saving || disabled} onClick={() => void confirmSave()}>{saving && <Loader2 className="animate-spin" size={17} />}{text('บันทึก', 'Save')}</button>
  </div>
}
