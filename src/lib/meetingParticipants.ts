export const meetingExecutiveOptions = [
  'นาย อรรถพล สมบัติเปี่ยม (อฝ.ลส.)',
  'นาย วรวิทย์ ว่องธนาการ (รฝ.ลส.(ว))',
  'นาง สิริรัศมิ์ ดุลยภาพัชร์ (รฝ.ลส.(ร))',
  'นางสาว อินทิรา เนียมศรี (รฝ.ลส.(อ))',
  'นางสาว ศศิวิมล วณีสอน (อก.คน.)',
  'นาย วินิจ ขันไชย (อก.กร.)',
  'นาย วรบุตร เอี่ยมศิลา (อก.บง.)',
  'นางสาว ดุสิตา พจนาภรณ์ (อก.กท.)',
] as const

export function parseMeetingParticipants(value: string): string[] {
  return value.split(/\s*,\s*/).map((name) => name.trim()).filter(Boolean)
}

export function serializeMeetingParticipants(names: string[]): string {
  return [...new Set(names)].join(', ')
}

export function formatMeetingParticipantPositions(value: string): string {
  return parseMeetingParticipants(value).map((name) => {
    if (!meetingExecutiveOptions.some((option) => option === name)) return name
    const opening = name.indexOf('(')
    const closing = name.lastIndexOf(')')
    return opening >= 0 && closing > opening ? name.slice(opening + 1, closing) : name
  }).join(', ')
}
