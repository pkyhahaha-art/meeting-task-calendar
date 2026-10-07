export const organizationUnits = ['ประจำฝ่าย (ฝลส.)', 'กกท.', 'กบง.', 'กคน.', 'กกร. (Team-Based)',
  'ประจำกอง (กบง.)', 'ประจำกอง (กคน.)', 'ประจำกอง (กกท.)'] as const
export type OrganizationUnit = typeof organizationUnits[number]
export const unspecifiedDepartment = 'ไม่ระบุ'

/** Display current names while continuing to accept saved legacy values. */
export function normalizeOrganizationUnit(unit?: string | null) {
  return unit === 'กกก.' ? 'กกท.' : unit === 'กกร.' ? 'กกร. (Team-Based)' : unit || ''
}

const departments: Record<OrganizationUnit, readonly string[]> = {
  'ประจำฝ่าย (ฝลส.)': [],
  'กกท.': ['ผนผ.', 'ผวผ.', 'ผกก.', 'ผปล.'],
  'กบง.': ['ผสอ.', 'ผสส.', 'ผพส.', 'ผรส.', 'ผบร.'],
  'กคน.': ['ผคอ.', 'ผคส.', 'ผพค.', 'ผปก.'],
  'กกร. (Team-Based)': [],
  'ประจำกอง (กบง.)': [],
  'ประจำกอง (กคน.)': [],
  'ประจำกอง (กกท.)': [],
}

export function departmentsFor(unit?: string | null): readonly string[] {
  const normalized = normalizeOrganizationUnit(unit) as OrganizationUnit
  return organizationUnits.includes(normalized) ? departments[normalized] : []
}

export function validOrganization(unit: string, department: string) {
  if (!organizationUnits.includes(normalizeOrganizationUnit(unit) as OrganizationUnit)) return false
  const options = departmentsFor(unit)
  return options.length ? department === '' || department === unspecifiedDepartment || options.includes(department) : department === ''
}

/** UI's explicit "unspecified" choice uses the existing nullable storage field. */
export function memberOrganizationData(unit: string, department: string) {
  return { organization_unit: normalizeOrganizationUnit(unit), department: !department || department === unspecifiedDepartment ? null : department }
}

/** Keep Task/Meeting's existing affiliation text and storage contract. */
export function profileAffiliation(profile?: { organization_unit?: string | null; department?: string | null } | null) {
  if (!profile?.organization_unit || !validOrganization(profile.organization_unit, profile.department || '')) return ''
  const { organization_unit, department } = memberOrganizationData(profile.organization_unit, profile.department || '')
  return organization_unit === 'ประจำฝ่าย (ฝลส.)' ? 'ฝลส.'
    : [department, organization_unit, 'ฝลส.'].filter(Boolean).join(' ')
}
