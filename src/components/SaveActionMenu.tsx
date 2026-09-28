import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import Swal from 'sweetalert2'

export function SaveActionMenu({ busy, onSave, onComplete }: { busy: boolean; onSave: (notifyRecipients: boolean) => Promise<boolean>; onComplete: () => void }) {
  const [savingWithNotification, setSavingWithNotification] = useState<boolean | null>(null)
  const saving = savingWithNotification !== null

  const confirmSave = async () => {
    if (busy || saving) return
    const result = await Swal.fire({
      icon: 'question',
      title: 'ยืนยันการบันทึก Meeting',
      text: 'เลือกวิธีการบันทึกที่ต้องการ',
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: 'บันทึกการแก้ไข',
      denyButtonText: 'บันทึกการแก้ไขและแจ้งเตือน',
      cancelButtonText: 'ยกเลิก',
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
        title: 'สำเร็จ',
        text: notifyRecipients ? 'บันทึกการแก้ไขและแจ้งเตือนผู้รับแล้ว' : 'บันทึกการแก้ไขเรียบร้อยแล้ว',
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
    <button type="button" className="btn-primary" disabled={busy || saving} onClick={() => void confirmSave()}>{saving && <Loader2 className="animate-spin" size={17} />}บันทึก</button>
  </div>
}
