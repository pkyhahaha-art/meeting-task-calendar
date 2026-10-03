export const organizationUnits = ['ประจำฝ่าย (ฝลส.)', 'กกก.', 'กบง.', 'กคน.', 'กกร.'] as const
export type OrganizationUnit = typeof organizationUnits[number]

const departments: Record<OrganizationUnit, readonly string[]> = {
  'ประจำฝ่าย (ฝลส.)': [],
  'กกก.': ['ผนผ.', 'ผวผ.', 'ผกก.', 'ผปล.'],
  'กบง.': ['ผสอ.', 'ผสส.', 'ผพส.', 'ผรส.', 'ผบร.'],
  'กคน.': ['ผคอ.', 'ผคส.', 'ผพค.', 'ผปก.'],
  'กกร.': [],
}

export function departmentsFor(unit?: string | null): readonly string[] {
  return organizationUnits.includes(unit as OrganizationUnit) ? departments[unit as OrganizationUnit] : []
}

export function validOrganization(unit: string, department: string) {
  if (!organizationUnits.includes(unit as OrganizationUnit)) return false
  const options = departmentsFor(unit)
  return options.length ? options.includes(department) : department === ''
}

/** Keep Task/Meeting's existing affiliation text and storage contract. */
export function profileAffiliation(profile?: { organization_unit?: string | null; department?: string | null } | null) {
  if (!profile?.organization_unit || !validOrganization(profile.organization_unit, profile.department || '')) return ''
  return profile.organization_unit === 'ประจำฝ่าย (ฝลส.)' ? 'ฝลส.'
    : [profile.department, profile.organization_unit, 'ฝลส.'].filter(Boolean).join(' ')
}
