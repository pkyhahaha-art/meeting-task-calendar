import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Swal from 'sweetalert2'
import { useAuth } from '../auth/AuthProvider'
import { useLanguage } from '../i18n/LanguageProvider'
import { supabase } from '../lib/supabase'
import { readCalendarPages } from '../lib/calendarView'
import { avatarGuestEmails } from '../lib/calendarAvatarPeople'
import type { Database } from '../lib/database.types'

type Profile = Database['public']['Tables']['profiles']['Row']
type Guest = Database['public']['Tables']['event_guests']['Row']

export async function uploadMemberAvatar(targetUserId: string, file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('INVALID_FILE_TYPE_OR_SIZE')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Image conversion failed'))), 'image/webp', 0.85)
    )
    const path = `${targetUserId}/avatar.webp`
    const upload = await supabase.storage.from('member-avatars').upload(path, blob, { contentType: 'image/webp', upsert: true, cacheControl: '0' })
    if (upload.error) throw upload.error
    const saved = await supabase.from('member_avatars').upsert({ user_id: targetUserId, storage_path: path, updated_at: new Date().toISOString() })
    if (saved.error) throw saved.error
  } finally {
    bitmap.close()
  }
}

export async function removeMemberAvatar(targetUserId: string) {
  const path = `${targetUserId}/avatar.webp`
  const removed = await supabase.storage.from('member-avatars').remove([path])
  if (removed.error) throw removed.error
  const record = await supabase.from('member_avatars').delete().eq('user_id', targetUserId)
  if (record.error) throw record.error
}

export function useAvatarDirectory() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['member-avatars', user?.id],
    enabled: Boolean(user),
    staleTime: 40 * 60 * 1000,
    refetchInterval: 40 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('member_avatars').select('*')
      if (error) {
        console.warn('Could not load member avatars directory:', error.message)
        return {} as Record<string, string>
      }
      return Object.fromEntries(
        await Promise.all(
          data.map(async (row) => {
            const signed = await supabase.storage.from('member-avatars').createSignedUrl(row.storage_path, 3600)
            return [row.user_id, signed.data?.signedUrl ?? '']
          })
        )
      ) as Record<string, string>
    },
  })
}

export function MemberAvatar({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  const avatars = useAvatarDirectory()
  const [failed, setFailed] = useState('')
  const url = avatars.data?.[id]
  return (
    <span className="member-avatar shrink-0 inline-flex items-center justify-center rounded-full overflow-hidden" title={name} style={{ width: size, height: size, minWidth: size, minHeight: size, fontSize: Math.max(9, size * 0.36) }}>
      {url && failed !== url ? <img src={url} alt={name} className="h-full w-full object-cover" onError={() => setFailed(url)} /> : <span aria-label={name}>{name.trim().slice(0, 1) || '?'}</span>}
    </span>
  )
}

export function ProfileAvatarEditor() {
  const { user, profile } = useAuth()
  const { text } = useLanguage()
  const cache = useQueryClient()
  const avatars = useAvatarDirectory()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const save = async (file?: File) => {
    if (!file || !user || busy) return
    setMessage('')
    setBusy(true)
    try {
      await uploadMemberAvatar(user.id, file)
      await cache.invalidateQueries({ queryKey: ['member-avatars'] })
      setMessage(text('บันทึกรูปแล้ว', 'Photo saved.'))
      void Swal.fire({
        icon: 'success',
        title: text('อัปโหลดรูปภาพแล้ว', 'Photo uploaded'),
        text: text('บันทึกรูปโปรไฟล์เรียบร้อยแล้ว', 'Profile photo updated successfully.'),
        confirmButtonText: text('ตกลง', 'OK'),
        confirmButtonColor: '#75638F',
      })
    } catch (err) {
      const isFileErr = err instanceof Error && err.message === 'INVALID_FILE_TYPE_OR_SIZE'
      const msg = isFileErr
        ? text('เลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB', 'Choose a JPG, PNG or WebP up to 5 MB.')
        : text('บันทึกรูปไม่สำเร็จ กรุณาลองใหม่ หากยังไม่ได้ให้ติดต่อผู้ดูแลระบบ', 'Could not save your photo. Retry or contact the administrator.')
      setMessage(msg)
      void Swal.fire({
        icon: isFileErr ? 'warning' : 'error',
        title: isFileErr ? text('ไฟล์รูปภาพไม่ถูกต้อง', 'Invalid image file') : text('บันทึกรูปไม่สำเร็จ', 'Upload failed'),
        text: msg,
        confirmButtonText: text('ตกลง', 'OK'),
        confirmButtonColor: '#75638F',
      })
    } finally {
      await cache.invalidateQueries({ queryKey: ['member-avatars'] })
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!user || busy) return
    setBusy(true)
    setMessage('')
    try {
      await removeMemberAvatar(user.id)
      await cache.invalidateQueries({ queryKey: ['member-avatars'] })
      setMessage(text('ลบรูปแล้ว', 'Photo removed.'))
      void Swal.fire({
        icon: 'success',
        title: text('ลบรูปภาพแล้ว', 'Photo removed'),
        confirmButtonText: text('ตกลง', 'OK'),
        confirmButtonColor: '#75638F',
      })
    } catch {
      const err = text('ลบรูปไม่สำเร็จ กรุณาลองใหม่', 'Could not remove photo. Please retry.')
      setMessage(err)
      void Swal.fire({
        icon: 'error',
        title: text('ลบรูปไม่สำเร็จ', 'Could not remove photo'),
        text: err,
        confirmButtonText: text('ตกลง', 'OK'),
        confirmButtonColor: '#75638F',
      })
    } finally {
      await cache.invalidateQueries({ queryKey: ['member-avatars'] })
      setBusy(false)
    }
  }

  return (
    <div className="profile-avatar-editor">
      {user && <MemberAvatar id={user.id} name={profile?.full_name || user.email || '?'} size={72} />}
      <div>
        <p className="font-semibold">{text('รูปโปรไฟล์', 'Profile photo')}</p>
        <p className="mb-2 text-xs text-slate-500">{text('JPG, PNG หรือ WebP ไม่เกิน 5 MB · รูปจะถูกครอบเป็นสี่เหลี่ยมตรงกลาง', 'JPG, PNG or WebP, up to 5 MB · Center cropped')}</p>
        <label className="btn-secondary cursor-pointer focus-within:ring-2 focus-within:ring-brand-400">
          {busy ? text('กำลังบันทึก…', 'Saving…') : text('เพิ่ม / เปลี่ยนรูป', 'Upload / change photo')}
          <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void save(event.target.files?.[0]); event.target.value = '' }} />
        </label>
        {user && avatars.data?.[user.id] && <button className="btn-secondary ml-2" disabled={busy} onClick={() => void remove()}>{text('ลบรูป', 'Remove')}</button>}
        {avatars.isError && <p role="status" className="mt-2 text-sm text-amber-700">{text('การอัปโหลดรูปยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ', 'Photo upload is unavailable. Contact the administrator.')}</p>}
        {message && <p role="status" className="mt-2 text-sm">{message}</p>}
      </div>
    </div>
  )
}

export function CalendarPeople({ ownerId, eventId, start, profiles, max = 2 }: { ownerId: string; eventId?: string; start?: string; profiles: Profile[]; max?: number }) {
  const avatars = useAvatarDirectory()
  const { text } = useLanguage()
  const roster = useQuery({
    queryKey: ['calendar-avatar-roster', eventId],
    enabled: Boolean(eventId && avatars.isSuccess),
    staleTime: 30000,
    queryFn: async () => {
      const [guests, occurrences] = await Promise.all([
        readCalendarPages<Guest>((offset) => supabase.from('event_guests').select('*', { count: 'exact' }).eq('event_id', eventId!).is('revoked_at', null).order('id').range(offset, offset + 499)),
        readCalendarPages<Database['public']['Tables']['event_occurrences']['Row']>((offset) => supabase.from('event_occurrences').select('*', { count: 'exact' }).eq('event_id', eventId!).order('id').range(offset, offset + 499)),
      ])
      const exclusions = [] as Database['public']['Tables']['event_occurrence_guest_exclusions']['Row'][]
      for (let index = 0; index < occurrences.length; index += 50) {
        const ids = occurrences.slice(index, index + 50).map((item) => item.id)
        exclusions.push(
          ...await readCalendarPages<Database['public']['Tables']['event_occurrence_guest_exclusions']['Row']>((offset) => supabase.from('event_occurrence_guest_exclusions').select('*', { count: 'exact' }).in('occurrence_id', ids).order('occurrence_id').order('email').range(offset, offset + 499))
        )
      }
      return { guests, occurrences, exclusions }
    },
  })
  const occurrence = roster.data?.occurrences.find((item) => new Date(item.start_datetime).getTime() === new Date(start || '').getTime())
  const emails = avatarGuestEmails(roster.data?.guests || [], roster.data?.exclusions || [], occurrence?.id, start)
  const people = profiles.filter((person) => person.id === ownerId || emails.has(person.email.trim().toLowerCase())).sort((a, b) => Number(b.id === ownerId) - Number(a.id === ownerId))
  if (!avatars.isSuccess || !people.length) return null
  return (
    <span className="calendar-people shrink-0 inline-flex items-center" aria-label={text('ผู้สร้างและผู้เข้าร่วม', 'Creator and attendees')}>
      {people.slice(0, max).map((person) => (
        <MemberAvatar key={person.id} id={person.id} name={person.full_name} size={18} />
      ))}
      {people.length > max && (
        <span className="calendar-people-more" title={people.slice(max).map((person) => person.full_name).join(', ')}>
          +{people.length - max}
        </span>
      )}
    </span>
  )
}
