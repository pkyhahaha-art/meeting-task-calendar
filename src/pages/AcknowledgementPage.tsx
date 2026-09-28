import { useEffect } from 'react'
import Swal from 'sweetalert2'

export function AcknowledgementPage() {
  useEffect(() => {
    void Swal.fire({
      icon: 'success',
      title: 'คุณรับทราบแล้ว',
      text: 'ระบบบันทึกการรับทราบเรียบร้อยแล้ว',
      showConfirmButton: false,
      showCloseButton: false,
      timer: 2000,
      timerProgressBar: true,
      allowOutsideClick: false,
      didOpen: (popup) => popup.querySelector('.swal2-confirm')?.remove(),
    }).then(() => window.close())
  }, [])

  return <main className="min-h-screen bg-slate-50" aria-label="กำลังยืนยันการรับทราบ" />
}
