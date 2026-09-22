type AuthErrorLike = { code?: string; status?: number }

export function forgotPasswordErrorMessage(error: AuthErrorLike) {
  if (error.code === 'over_email_send_rate_limit') {
    return 'ระบบส่งอีเมลถึงขีดจำกัดที่ตั้งไว้แล้ว กรุณารอสักครู่แล้วลองใหม่'
  }
  if (error.code === 'over_request_rate_limit' || error.status === 429) {
    return 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'
  }
  return 'ส่งลิงก์ไม่สำเร็จ กรุณารอสักครู่แล้วลองใหม่'
}
