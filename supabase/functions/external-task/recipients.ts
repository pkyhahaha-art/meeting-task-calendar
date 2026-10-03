export function initialExternalRecipients(
  emails: readonly string[], creatorEmail: string, internalEmails: readonly string[],
) {
  const alreadyNotified = new Set([creatorEmail, ...internalEmails].map((email) => email.trim().toLowerCase()))
  return [...new Set(emails.map((email) => email.trim().toLowerCase()))]
    .filter((email) => email && !alreadyNotified.has(email))
}
