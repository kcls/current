// API Request and Response Types for the Current incident tracker

// Common filter types
export interface DateRangeFilter {
  start_date?: string;
  end_date?: string;
}

export interface PaginationFilter {
  page?: number;
  page_size?: number;
  ordering?: string;
  limit?: number;  // Odo uses limit
  offset?: number; // Odo uses offset
}

export interface SearchFilter {
  search?: string;
  search_fields?: string[];
  q?: string;  // Alternative search param
}

// Odo zcrud specific types
export interface AuthzSearchParams {
  model: string;  // Model code like 'ii' for incidents
  filters?: Record<string, any>;
  options?: {
    limit?: number;
    offset?: number;
    order_by?: {
      field: string;
      direction: 'asc' | 'desc';
    };
    joins?: Record<string, any>;
  };
}

// Analytics Types
export interface PatternAnalysisParams extends DateRangeFilter {
  location_id?: number;
  pattern_type?: 'temporal' | 'geographic' | 'incident_type' | 'patron';
  min_occurrences?: number;
}

export interface PatternAnalysisResponse {
  patterns: Array<{
    id: string;
    type: string;
    description: string;
    occurrences: number;
    confidence: number;
    details: Record<string, unknown>;
    related_incidents: number[];
  }>;
  summary: {
    total_patterns: number;
    high_confidence_patterns: number;
    period: DateRangeFilter;
  };
}

// Search Types
export interface SearchParams extends PaginationFilter, SearchFilter {
  filters?: Record<string, unknown>;
  include_archived?: boolean;
  include_deleted?: boolean;
}

export interface IncidentSearchParams extends SearchParams {
  org_unit?: string;
  template_id?: number;
  status?: string;
  start_date?: string;
  end_date?: string;
  created_by?: string;
  assigned_to?: string;
  patron_id?: string | number;
}

export interface PatronSearchParams extends SearchParams {
  has_bans?: boolean;
  has_incidents?: boolean;
  is_banned?: boolean;
  ban_status?: string;
}

export interface TemplateSearchParams extends SearchParams {
  category?: string;
  is_active?: boolean;
}

// Report Types
export interface ReportParams extends DateRangeFilter {
  report_type: 'incidents' | 'patrons' | 'staff' | 'locations' | 'summary';
  format?: 'json' | 'csv' | 'pdf';
  org_unit?: string;
  include_sub_locations?: boolean;
  group_by?: string[];
}

export interface ReportResponse {
  id: string;
  report_type: string;
  generated_at: string;
  generated_by: string;
  parameters: ReportParams;
  data?: any;
  file_url?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

// Bulk operation types
export interface BulkOperationParams {
  operation: 'update' | 'delete' | 'archive' | 'assign';
  ids: number[];
  data?: Record<string, any>;
}

export interface BulkOperationResponse {
  success: number[];
  failed: Array<{
    id: number;
    error: string;
  }>;
  total: number;
}

// File upload types
export interface FileUploadResponse {
  id: number;
  url: string;
  filename: string;
  size: number;
  mime_type: string;
  uploaded_at: string;
}

// Notification types
export interface NotificationParams {
  type: 'emergency' | 'assignment' | 'review' | 'update' | 'alert';
  recipients?: number[];
  incident?: number;
  message?: string;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  incident?: number;
  created_at: string;
  read: boolean;
  read_at?: string;
  action_url?: string;
  metadata?: Record<string, any>;
}

// Error response type
export interface ApiError {
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  message?: string;
  status?: number;
}

// Success response wrapper
export interface ApiResponse<T = any> {
  data?: T;
  success?: boolean;
  message?: string;
  metadata?: {
    timestamp: string;
    request_id?: string;
    [key: string]: any;
  };
}