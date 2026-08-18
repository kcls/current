// Settings and configuration types

export interface SavedOrgUnit {
  uuid: string;
  code?: string;
  label: string;
  last_used_at: string;
}

// System-wide settings (admin configurable)
export interface SystemSettings {
  incident_management: {
    allow_anonymous_reporting: boolean;
    require_manager_approval: boolean;
    auto_assign_coordinator: boolean;
    max_attachment_size_mb: number;
    allowed_file_types: string[];
    retention_days: number;
    allow_draft_incidents: boolean;
    draft_auto_save_interval: number;
    require_location_for_incident: boolean;
  };
  patron_management: {
    ban_letter_footer: string;
    max_ban_duration_days: number;
    allow_permanent_bans: boolean;
    require_photo_for_ban: boolean;
    auto_expire_bans: boolean;
    ban_appeal_days: number;
  };
  notifications: {
    email_enabled: boolean;
    sms_enabled: boolean;
    emergency_alert_enabled: boolean;
    coordinator_daily_summary: boolean;
    manager_weekly_report: boolean;
  };
  ai_features: {
    emergency_analysis_enabled: boolean;
    pattern_detection_enabled: boolean;
    auto_categorization_enabled: boolean;
    sentiment_analysis_enabled: boolean;
    risk_assessment_enabled: boolean;
  };
}

// User-specific preferences
export interface UserPreferences {
  appearance: {
    theme: 'light' | 'dark' | 'system';
    high_contrast: boolean;
    pure_black_mode: boolean;
    primary_color: string;
    font_size: 'small' | 'medium' | 'large';
    density: 'compact' | 'comfortable' | 'spacious';
  };
  behavior: {
    confirm_delete: boolean;
    auto_save: boolean;
    default_view: 'grid' | 'list' | 'compact';
    items_per_page: number;
  };
  notifications: {
    email_enabled: boolean;
    in_app_enabled: boolean;
    incident_updates: 'immediate' | 'hourly' | 'daily' | 'disabled';
    system_announcements: 'immediate' | 'daily' | 'weekly' | 'disabled';
    report_ready: 'immediate' | 'daily' | 'disabled';
  };
  dashboard: {
    widgets: string[];
    refresh_interval: number;
  };
  accessibility: {
    high_contrast: boolean;
    reduce_animations: boolean;
    screen_reader_mode: boolean;
    screen_reader_announcements: boolean;
    focus_indicators: boolean;
    enhanced_focus_indicators: boolean;
  };
  keyboard: {
    shortcuts_enabled: boolean;
    custom_shortcuts: Record<string, string>;
    custom_actions: string[];
  };
}

// Legacy types preserved for compatibility
export interface NotificationPreferences {
  enabled: boolean;
  sound: boolean;
  desktop: boolean;
  email: boolean;
  types: {
    emergency: boolean;
    assignment: boolean;
    review: boolean;
    alert: boolean;
    update: boolean;
  };
}

export interface DashboardPreferences {
  defaultView: 'grid' | 'list' | 'compact';
  widgets: string[];
  refreshInterval: number;  // in seconds
  showStats: boolean;
  showRecentActivity: boolean;
  showAlerts: boolean;
}

export interface AccessibilityPreferences {
  highContrast: boolean;
  reducedMotion: boolean;
  screenReaderMode: boolean;
  fontSize: 'small' | 'medium' | 'large';
  keyboardShortcuts: boolean;
}

// Dashboard types
export interface DashboardStats {
  total?: number;
  active: number;
  resolved: number;
  closed: number;
  total_today: number;
  total_week: number;
  total_month: number;
  this_month?: number;
  requires_follow_up?: number;
  by_location: Record<number, number>;
  assigned_to_me: number;
  created_by_me: number;
}

export interface TrendData {
  date: string;
  incidents: number;
  resolved: number;
}

export interface AlertSummary {
  active_alerts: number;
  critical_alerts: number;
  high_alerts: number;
  medium_alerts: number;
  low_alerts: number;
  acknowledged_today: number;
  pending_acknowledgment: number;
}

export interface AnalyticsData {
  incident_trends: {
    daily_average: number;
    weekly_average: number;
    monthly_average: number;
    trend_direction: 'up' | 'down' | 'stable';
    trend_percentage: number;
  };
  response_times: {
    average_response_minutes: number;
    average_resolution_hours: number;
    fastest_response_minutes: number;
    slowest_response_minutes: number;
  };
  category_breakdown: Record<string, number>;
  staff_performance: {
    most_active: string;
    most_resolved: string;
    fastest_responder: string;
    most_templates_created: string;
  };
}

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'auto';
  primaryColor: string;
  secondaryColor: string;
  fontSize: number;
  fontFamily: string;
  borderRadius: number;
  spacing: number;
}

export interface KeyboardShortcut {
  id: string;
  name: string;
  description: string;
  keys: string[];
  action: string;
  context?: string;
  enabled: boolean;
}

export interface QuickAccessItem {
  id: string;
  type: 'location' | 'template' | 'report' | 'action';
  label: string;
  icon?: string;
  url?: string;
  action?: string;
  metadata?: Record<string, any>;
}

export interface CustomField {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    pattern?: string;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
  };
  helpText?: string;
  defaultValue?: any;
}