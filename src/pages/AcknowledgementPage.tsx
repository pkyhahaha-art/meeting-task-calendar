import { useEffect } from 'react'
import Swal from 'sweetalert2'

export function AcknowledgementPage() {
  useEffect(() => {
    void Swal.fire({
      icon: 'success',
      title: 'คุณรับทราบแล้ว',
      text: 'ระบบบันทึกการรับทราบเรียบร้อยแล้ว',
      confirmButtonText: 'ปิด',
      confirmButtonColor: '#15803d',
      allowOutsideClick: false,
    }).then(() => window.close())
  }, [])

  return <main className="min-h-screen bg-slate-50" aria-label="กำลังยืนยันการรับทราบ" />
}
