import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

type Language = 'th' | 'en'

const messages = {
  th: {
    appName: 'ปฏิทินการประชุม', calendar: 'ปฏิทิน', signIn: 'เข้าสู่ระบบ', signOut: 'ออกจากระบบ',
    register: 'สมัครสมาชิก', email: 'Gmail', password: 'รหัสผ่าน', forgotPassword: 'ลืมรหัสผ่าน?',
    noAccount: 'ยังไม่มีบัญชี?', haveAccount: 'มีบัญชีแล้ว?', fullName: 'ชื่อ-นามสกุล', employeeId: 'รหัสพนักงาน',
    confirmPassword: 'ยืนยันรหัสผ่าน', createAccount: 'สร้างบัญชี', loading: 'กำลังโหลด…',
  },
  en: {
    appName: 'Meeting Calendar', calendar: 'Calendar', signIn: 'Sign in', signOut: 'Sign out',
    register: 'Register', email: 'Gmail', password: 'Password', forgotPassword: 'Forgot password?',
    noAccount: "Don't have an account?", haveAccount: 'Already have an account?', fullName: 'Full name', employeeId: 'Employee ID',
    confirmPassword: 'Confirm password', createAccount: 'Create account', loading: 'Loading…',
  },
} as const

type MessageKey = keyof typeof messages.th
type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: (key: MessageKey) => string }

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => localStorage.getItem('ui-language') === 'en' ? 'en' : 'th')
  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage: (next) => { localStorage.setItem('ui-language', next); setLanguageState(next) },
    t: (key) => messages[language][key],
  }), [language])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider')
  return context
}
