export const organizationUnits = ['ฝลส.', 'กกท.', 'กบง.', 'กคน.', 'กกร.'] as const
export type OrganizationUnit = typeof organizationUnits[number]
export const unspecifiedDepartment = 'อื่นๆ'

/** Legacy member values remain readable without rewriting existing records. */
export function normalizeOrganizationUnit(unit?: string | null) {
  if (unit === 'ประจำฝ่าย (ฝลส.)') return 'ฝลส.'
  if (unit === 'กกก.') return 'กกท.'
  if (unit === 'กกร. (Team-Based)') return 'กกร.'
  const headOffice = /^ประจำกอง \((กบง\.|กคน\.|กกท\.)\)$/.exec(unit || '')
  return headOffice?.[1] || unit || ''
}

const departments: Record<OrganizationUnit, readonly string[]> = {
  'ฝลส.': [],
  'กกท.': ['ประจำกอง กกท.', 'ผนผ.', 'ผวผ.', 'ผกก.', 'ผปส.', unspecifiedDepartment],
  'กบง.': ['ประจำกอง กบง.', 'ผสอ.', 'ผสส.', 'ผพส.', 'ผรส.', 'ผบธ.', unspecifiedDepartment],
  'กคน.': ['ประจำกอง กคน.', 'ผคอ.', 'ผคส.', 'ผพค.', 'ผปก.', unspecifiedDepartment],
  'กกร.': [],
}

export function normalizeOrganizationSelection(unit?: string | null, department?: string | null) {
  const normalizedUnit = normalizeOrganizationUnit(unit)
  const headOffice = /^ประจำกอง \((กบง\.|กคน\.|กกท\.)\)$/.exec(unit || '')
  let normalizedDepartment = department || (headOffice ? `ประจำกอง ${headOffice[1]}` : '')
  if (normalizedDepartment === 'ไม่ระบุ') normalizedDepartment = unspecifiedDepartment
  if (normalizedUnit === 'กกท.' && normalizedDepartment === 'ผปล.') normalizedDepartment = 'ผปส.'
  if (normalizedUnit === 'กบง.' && normalizedDepartment === 'ผบร.') normalizedDepartment = 'ผบธ.'
  return { unit: normalizedUnit, department: normalizedDepartment }
}

export function departmentsFor(unit?: string | null): readonly string[] {
  const normalized = normalizeOrganizationUnit(unit) as OrganizationUnit
  return organizationUnits.includes(normalized) ? departments[normalized] : []
}

export function validOrganization(unit: string, department: string) {
  const normalized = normalizeOrganizationSelection(unit, department)
  if (!organizationUnits.includes(normalized.unit as OrganizationUnit)) return false
  const options = departmentsFor(normalized.unit)
  return options.length ? normalized.department === '' || options.includes(normalized.department) : normalized.department === ''
}

/** Explicit other/legacy unspecified uses the existing nullable field. */
export function memberOrganizationData(unit: string, department: string) {
  const normalized = normalizeOrganizationSelection(unit, department)
  return { organization_unit: normalized.unit, department: !normalized.department || normalized.department === unspecifiedDepartment ? null : normalized.department }
}

/** Defaults for new drafts only; saved Task/Meeting text stays unchanged. */
export function profileAffiliation(profile?: { organization_unit?: string | null; department?: string | null } | null) {
  if (!profile?.organization_unit || !validOrganization(profile.organization_unit, profile.department || '')) return ''
  const { organization_unit, department } = memberOrganizationData(profile.organization_unit, profile.department || '')
  return !department || department.startsWith('ประจำกอง ')
    ? organization_unit : [department, organization_unit].join(' ')
}
