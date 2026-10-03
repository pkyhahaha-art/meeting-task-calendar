import { z } from 'zod'
import { departmentsFor, organizationUnits } from './organization'

export const loginSchema = z.object({
  email: z.string().trim().email('กรุณากรอก Gmail ให้ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
})

const personalNameSchema = z.string()
  .trim()
  .min(1, 'กรุณากรอกข้อมูล')
  .max(60, 'กรอกได้ไม่เกิน 60 ตัวอักษร')
  .regex(/^[A-Za-zก-ฮะ-ฺเ-์]+(?: [A-Za-zก-ฮะ-ฺเ-์]+)*$/, 'ใช้ได้เฉพาะตัวอักษรไทยหรืออังกฤษ')

export const registrationSchema = z.object({
  namePrefix: z.enum(['นาย', 'นาง', 'นางสาว'], { message: 'กรุณาเลือกคำนำหน้า' }),
  firstName: personalNameSchema,
  lastName: personalNameSchema,
  employeeId: z.string().trim().regex(/^\d{6}$/, 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก'),
  organizationUnit: z.enum(organizationUnits, { message: 'กรุณาเลือกหน่วยงาน' }),
  department: z.string(),
  email: z.string().trim().email('กรุณากรอก Gmail ให้ถูกต้อง').refine((value) => value.toLowerCase().endsWith('@gmail.com'), 'ต้องใช้ที่อยู่ @gmail.com'),
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(72).regex(/[A-Za-z]/, 'ต้องมีตัวอักษรอย่างน้อย 1 ตัว').regex(/[0-9]/, 'ต้องมีตัวเลขอย่างน้อย 1 ตัว'),
  confirmPassword: z.string(),
}).superRefine((data, context) => {
  const departments = departmentsFor(data.organizationUnit)
  if (departments.length ? !departments.includes(data.department) : data.department !== '') {
    context.addIssue({ code: 'custom', message: departments.length ? 'กรุณาเลือกแผนกภายใต้หน่วยงานที่เลือก' : 'หน่วยงานนี้ไม่มีแผนก', path: ['department'] })
  }
  if (data.password !== data.confirmPassword) context.addIssue({ code: 'custom', message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน', path: ['confirmPassword'] })
})

export type LoginValues = z.infer<typeof loginSchema>
export type RegistrationValues = z.infer<typeof registrationSchema>
