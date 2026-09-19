export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          employee_id: string | null
          full_name: string
          email: string
          email_verified_at: string | null
          role: 'user' | 'admin'
          ui_language: 'th' | 'en'
          status: 'pending_verification' | 'active' | 'disabled'
          created_at: string
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string; full_name: string; email: string }
        Update: Partial<Database['public']['Tables']['profiles']['Row']>
        Relationships: []
      }
      line_connections: {
        Row: { user_id: string; line_user_id: string; connected_at: string; disconnected_at: string | null }
        Insert: { user_id: string; line_user_id: string; connected_at?: string; disconnected_at?: string | null }
        Update: Partial<Database['public']['Tables']['line_connections']['Insert']>
        Relationships: []
      }
      events: {
        Row: {
          id: string
          owner_user_id: string
          title: string
          description: string
          start_datetime: string
          end_datetime: string | null
          all_day: boolean
          location: string
          timezone: string
          recurrence_rule: string | null
          status: 'scheduled' | 'cancelled'
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          owner_user_id: string
          title: string
          description?: string
          start_datetime: string
          end_datetime?: string | null
          all_day?: boolean
          location?: string
          timezone?: string
          recurrence_rule?: string | null
          status?: 'scheduled' | 'cancelled'
          deleted_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['events']['Insert']>
        Relationships: []
      }
      event_guests: {
        Row: { id: string; event_id: string; email: string; revoked_at: string | null; created_at: string }
        Insert: { id?: string; event_id: string; email: string; revoked_at?: string | null }
        Update: Partial<Database['public']['Tables']['event_guests']['Insert']>
        Relationships: []
      }
      attachments: {
        Row: { id: string; event_id: string; occurrence_id: string | null; file_name: string; mime_type: string; file_size: number; storage_path: string; scope: 'series' | 'occurrence'; uploaded_by: string; uploaded_at: string }
        Insert: { id?: string; event_id: string; occurrence_id?: string | null; file_name: string; mime_type: string; file_size: number; storage_path: string; scope?: 'series' | 'occurrence'; uploaded_by: string }
        Update: Partial<Database['public']['Tables']['attachments']['Insert']>
        Relationships: []
      }
      reminders: {
        Row: { id: string; event_id: string; occurrence_id: string | null; offset_value: number; offset_unit: 'minute' | 'hour' | 'day' | 'week' | 'month'; scheduled_at: string; channel_email: boolean; channel_line: boolean; status: 'scheduled' | 'processing' | 'completed' | 'cancelled'; created_at: string; updated_at: string }
        Insert: { id?: string; event_id: string; occurrence_id?: string | null; offset_value: number; offset_unit: 'minute' | 'hour' | 'day' | 'week' | 'month'; scheduled_at: string; channel_email?: boolean; channel_line?: boolean; status?: 'scheduled' | 'processing' | 'completed' | 'cancelled' }
        Update: Partial<Database['public']['Tables']['reminders']['Insert']>
        Relationships: []
      }
      tasks: {
        Row: {
          id: string
          creator_user_id: string
          assignee_type: 'internal' | 'external'
          assignee_user_id: string | null
          external_assignee_email: string | null
          linked_event_id: string | null
          title: string
          description: string
          due_date: string
          due_time: string | null
          timezone: string
          status: 'pending' | 'completed' | 'cancelled'
          completed_at: string | null
          deleted_at: string | null
          recurrence_rule: string | null
          recurrence_series_id: string | null
          recurrence_end_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          creator_user_id: string
          assignee_type: 'internal' | 'external'
          assignee_user_id?: string | null
          external_assignee_email?: string | null
          linked_event_id?: string | null
          title: string
          description?: string
          due_date: string
          due_time?: string | null
          timezone?: string
          status?: 'pending' | 'completed' | 'cancelled'
          completed_at?: string | null
          deleted_at?: string | null
          recurrence_rule?: string | null
          recurrence_series_id?: string | null
          recurrence_end_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['tasks']['Insert']>
        Relationships: []
      }
      task_reminders: {
        Row: {
          id: string
          task_id: string
          reminder_key: 'due' | '1_hour' | '1_day' | '3_days' | 'overdue'
          scheduled_at: string
          channel_email: boolean
          channel_line: boolean
          status: 'scheduled' | 'processing' | 'completed' | 'cancelled' | 'deferred_quota'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          task_id: string
          reminder_key: 'due' | '1_hour' | '1_day' | '3_days' | 'overdue'
          scheduled_at: string
          channel_email?: boolean
          channel_line?: boolean
          status?: 'scheduled' | 'processing' | 'completed' | 'cancelled' | 'deferred_quota'
        }
        Update: Partial<Database['public']['Tables']['task_reminders']['Insert']>
        Relationships: []
      }
      task_attachments: {
        Row: { id: string; task_id: string; file_name: string; mime_type: string; file_size: number; storage_path: string; uploaded_by: string; uploaded_at: string }
        Insert: { id?: string; task_id: string; file_name: string; mime_type: string; file_size: number; storage_path: string; uploaded_by: string }
        Update: Partial<Database['public']['Tables']['task_attachments']['Insert']>
        Relationships: []
      }
      document_links: {
        Row: { id: string; event_id: string | null; task_id: string | null; display_name: string; url: string; provider: 'google_drive'; added_by: string; created_at: string }
        Insert: { id?: string; event_id?: string | null; task_id?: string | null; display_name: string; url: string; provider?: 'google_drive'; added_by: string }
        Update: Partial<Database['public']['Tables']['document_links']['Insert']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      admin_set_profile_status: {
        Args: { target_user_id: string; next_status: 'active' | 'disabled' }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
