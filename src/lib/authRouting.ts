export function homePathForRole(role?: 'user' | 'admin') {
  return role === 'admin' ? '/admin' : '/calendar'
}
