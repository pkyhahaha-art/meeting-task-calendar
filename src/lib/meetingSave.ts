export type MeetingSaveAttempt = { userId: string; eventId: string } | null

// Keep the same primary key when a committed request loses its response.
export function meetingSaveId(
  existingId: string | undefined,
  userId: string,
  attempt: { current: MeetingSaveAttempt },
  createId: () => string = () => crypto.randomUUID(),
) {
  if (existingId) return existingId
  if (!attempt.current || attempt.current.userId !== userId) {
    attempt.current = { userId, eventId: createId() }
  }
  return attempt.current.eventId
}

export async function saveMeetingWithFollowUp(
  eventId: string,
  saveCore: (eventId: string) => Promise<string>,
  saveFollowUp: (savedEventId: string) => Promise<void>,
) {
  const savedEventId = await saveCore(eventId)
  try {
    await saveFollowUp(savedEventId)
    return { eventId: savedEventId, warning: '' }
  } catch (reason) {
    const details = reason instanceof Error ? reason.message : 'กรุณาตรวจสอบการประชุมก่อนทำรายการซ้ำ'
    return { eventId: savedEventId, warning: `บันทึกการประชุมแล้ว แต่ไฟล์แนบหรือการแจ้งเตือนอาจยังไม่ครบ: ${details}` }
  }
}
