import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().trim().email('กรุณากรอก Gmail ให้ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
})

export const registrationSchema = z.object({
  fullName: z.string().trim().min(2, 'กรุณากรอกชื่อ-นามสกุล').max(120),
  employeeId: z.string().trim().min(2, 'กรุณากรอกรหัสพนักงาน').max(30).regex(/^[A-Za-z0-9._-]+$/, 'ใช้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง หรือขีดล่าง'),
  email: z.string().trim().email('กรุณากรอก Gmail ให้ถูกต้อง').refine((value) => value.toLowerCase().endsWith('@gmail.com'), 'ต้องใช้ที่อยู่ @gmail.com'),
  password: z.string().min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร').max(72).regex(/[A-Za-z]/, 'ต้องมีตัวอักษรอย่างน้อย 1 ตัว').regex(/[0-9]/, 'ต้องมีตัวเลขอย่างน้อย 1 ตัว'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, { message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน', path: ['confirmPassword'] })

export type LoginValues = z.infer<typeof loginSchema>
export type RegistrationValues = z.infer<typeof registrationSchema>

