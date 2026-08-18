import React from 'react';
import {
  Typography,
  TextField,
  Button,
  Box,
  FormControlLabel,
  Checkbox,
  CircularProgress,
  Autocomplete,
  Chip,
  Divider,
} from '@mui/material';
import {
  Save as SaveIcon,
  PersonAdd as PersonAddIcon,
  NavigateNext as NextIcon,
  Gavel as GavelIcon,
} from '@mui/icons-material';
import type { FileUploadResponse } from '@core/api/upload';
import { StaffSearch, type StaffOption } from '../../../shared/components/staff-search';
import type { ExternalLinkFormData } from './external-link-dialog';
import type { IncidentTemplate, PatronBanStatus } from '../../../types';
import type { PatronSearchResult } from '../../../types';
import type { StaffSearchResult } from '../../../api/staff';

import { LocationSection } from './location-section';
import { InvolvedPatronsSection } from './involved-patrons-section';
import { AttachmentsSection } from './attachments-section';
import { ExternalLinksSection } from './external-links-section';

interface StaffFormOption extends StaffOption {
  uuid?: string;
  role?: string;
}

interface OrgUnit {
  id: number;
  uuid: string;
  label: string;
  display_label?: string;
  is_active?: boolean;
  unit_type_object?: { can_have_patrons?: boolean };
}

interface SubLocation {
  id: number;
  name: string;
}

export interface IncidentFormState {
  title: string;
  description: string;
  template_ids: number[];
  org_unit: string | null;
  sub_location: number | null;
  involved_parties: string[];
  other_staff_involved: string[];
  metadata: Record<string, any>;
  attachments?: FileUploadResponse[];
  requires_follow_up: boolean;
  follow_up_date?: string;
  notes?: string;
  incident_date?: string;
  incident_time?: string;
  external_links?: string[];
  called_emergency?: boolean;
}

export interface PatronProps {
  selected: PatronSearchResult[];
  setSelected: React.Dispatch<React.SetStateAction<PatronSearchResult[]>>;
  searchResults: PatronSearchResult[];
  isSearching: boolean;
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  search: (term: string) => void;
  notes: Record<string, string>;
  setNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  banStatus: Record<string, PatronBanStatus>;
  clearBanIntents: (patronId: string) => void;
}

export interface StaffProps {
  selected: StaffSearchResult[];
  setSelected: React.Dispatch<React.SetStateAction<StaffSearchResult[]>>;
  notes: Record<string, string>;
  setNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSearch: (query: string) => Promise<StaffOption[]>;
}

export interface AttachmentProps {
  files: FileUploadResponse[];
  isUploading: boolean;
  progress: Record<string, number>;
  maxFiles: number;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
}

interface StepReportProps {
  formData: IncidentFormState;
  errors: Record<string, string>;
  onInputChange: (field: keyof IncidentFormState, value: any) => void;
  clearError: (field: string) => void;
  isEditMode: boolean;
  isSubmitting: boolean;
  templates: IncidentTemplate[];
  locations: OrgUnit[];
  availableLocationOptions: OrgUnit[];
  subLocations: SubLocation[];
  isLoadingSubLocations: boolean;
  patron: PatronProps;
  staff: StaffProps;
  shouldShowCalledEmergency: boolean;
  attachment: AttachmentProps;
  externalLinks: ExternalLinkFormData[];
  setExternalLinks: React.Dispatch<React.SetStateAction<ExternalLinkFormData[]>>;
  onNext: () => void;
  onSaveReport?: () => void;
  hasReviewChain: boolean | null;
  onSubmitForReview?: () => void;
  onSaveAndBan?: () => void;
}

export const StepReport: React.FC<StepReportProps> = ({
  formData,
  errors,
  onInputChange,
  clearError,
  isEditMode,
  isSubmitting,
  templates,
  locations,
  availableLocationOptions,
  subLocations,
  isLoadingSubLocations,
  patron,
  staff,
  shouldShowCalledEmergency,
  attachment,
  externalLinks,
  setExternalLinks,
  onNext,
  onSaveReport,
  onSaveAndBan,
}) => {
  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* Incident Narrative */}
        <TextField
          fullWidth
          required
          multiline
          rows={3}
          label="Incident Narrative"
          value={formData.description}
          onChange={(e) => onInputChange('description', e.target.value)}
          error={!!errors.description}
          helperText={errors.description}
        />

        {/* Incident Templates */}
        <Box>
          <Autocomplete
            multiple
            fullWidth
            options={templates
              .filter((t) => t.is_active !== false)
              .sort((a, b) => a.name.localeCompare(b.name))}
            getOptionLabel={(option) => option.name}
            value={formData.template_ids
              .map((tid) => templates.find((t) => t.id === tid))
              .filter((t): t is IncidentTemplate => t !== undefined)}
            onChange={(_, newValue) => {
              onInputChange(
                'template_ids',
                newValue.map((t) => t.id as number),
              );
              if (errors.template_ids) clearError('template_ids');
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip label={option.name} {...getTagProps({ index })} key={option.id} />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Incident Templates"
                required
                placeholder="Select one or more templates"
                error={!!errors.template_ids}
                helperText={errors.template_ids || 'Select all incident types that apply to this incident'}
              />
            )}
          />
        </Box>

        {/* Location and Sub-location */}
        <LocationSection
          orgUnit={formData.org_unit}
          subLocation={formData.sub_location}
          locations={locations}
          availableLocationOptions={availableLocationOptions}
          subLocations={subLocations}
          isLoadingSubLocations={isLoadingSubLocations}
          isEditMode={isEditMode}
          errors={errors}
          onInputChange={onInputChange}
          clearError={clearError}
        />

        {/* Involved Patrons */}
        <InvolvedPatronsSection
          patron={patron}
          locations={locations}
          orgUnit={formData.org_unit}
          errors={errors}
          clearError={clearError}
        />

        {/* Involved Staff */}
        <Box>
          <Typography
            variant="subtitle2"
            gutterBottom
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <PersonAddIcon fontSize="small" />
            Involved Staff
          </Typography>
          <Box>
            <StaffSearch<StaffFormOption>
              label="Search for staff who witnessed or were involved in this incident"
              placeholder="Type to search by name, username, or email..."
              value={staff.selected.map((s) => ({
                id: s.id,
                uuid: s.uuid,
                display_name: s.display_name,
                email: s.email,
                role: s.role,
              }))}
              onChange={(newValue) => {
                const staffResults = newValue.map((v) => ({
                  id: v.id as number,
                  uuid: v.uuid || '',
                  display_name: v.display_name,
                  email: v.email,
                  role: v.role,
                })) as StaffSearchResult[];
                staff.setSelected(staffResults);
                const staffIds = staffResults.map((s) => s.uuid);
                onInputChange('other_staff_involved', staffIds);
              }}
              onSearch={staff.onSearch}
              getSecondaryText={(option) =>
                [option.email, option.role].filter(Boolean).join(' • ')
              }
              noOptionsText="No staff found"
            />

            {staff.selected.length > 0 && (
              <Box sx={{ mt: 2 }}>
                {staff.selected.map((s) => (
                  <TextField
                    key={s.uuid}
                    fullWidth
                    multiline
                    rows={2}
                    label={`Notes for ${s.display_name}`}
                    value={staff.notes[s.uuid] || ''}
                    onChange={(e) =>
                      staff.setNotes((prev) => ({ ...prev, [s.uuid]: e.target.value }))
                    }
                    sx={{ mb: 2 }}
                    placeholder="Add any notes about this staff member's involvement..."
                  />
                ))}
              </Box>
            )}
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* When did this incident occur? */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            When did this incident occur?
          </Typography>
          <Box display="flex" gap={2}>
            <TextField
              type="date"
              label="Date"
              value={formData.incident_date}
              onChange={(e) => onInputChange('incident_date', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              required
              sx={{ flex: 1 }}
            />
            <TextField
              type="time"
              label="Time"
              value={formData.incident_time}
              onChange={(e) => onInputChange('incident_time', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              required
              sx={{ flex: 1 }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" gutterBottom display="block">
            Select the actual date and time when the incident happened
          </Typography>
        </Box>

        {/* 911/988 checkbox */}
        {shouldShowCalledEmergency && (
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={formData.called_emergency || false}
                  onChange={(e) => onInputChange('called_emergency', e.target.checked)}
                />
              }
              label="Called 911 or 988"
            />
            <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 4 }}>
              Check if emergency services (911) or mental health crisis line (988) were contacted
            </Typography>
          </Box>
        )}

        {/* Resolution Checklist */}
        {(() => {
          const resolutionChecklist = formData.metadata?.resolution_checklist;
          if (
            resolutionChecklist &&
            Array.isArray(resolutionChecklist) &&
            resolutionChecklist.length > 0
          ) {
            return (
              <Box
                sx={{
                  p: 2,
                  border: '1px solid',
                  borderColor: 'warning.main',
                  borderRadius: 1,
                  bgcolor: (theme) =>
                    theme.palette.mode === 'dark'
                      ? 'rgba(255, 167, 38, 0.1)'
                      : 'rgba(255, 167, 38, 0.05)',
                }}
              >
                <Typography variant="subtitle2" gutterBottom color="warning.dark">
                  Resolution Checklist
                </Typography>
                <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                  Please ensure these steps are completed when resolving this incident:
                </Typography>
                <Box sx={{ mt: 1 }}>
                  {resolutionChecklist.map((item: string, index: number) => (
                    <FormControlLabel
                      key={index}
                      control={
                        <Checkbox
                          size="small"
                          checked={
                            formData.metadata?.resolution_checklist_status?.[index] || false
                          }
                          onChange={(e) => {
                            onInputChange('metadata', {
                              ...formData.metadata,
                              resolution_checklist_status: {
                                ...(formData.metadata.resolution_checklist_status || {}),
                                [index]: e.target.checked,
                              },
                            });
                          }}
                        />
                      }
                      label={<Typography variant="body2">{item}</Typography>}
                      sx={{ display: 'block', mb: 0.5 }}
                    />
                  ))}
                </Box>
              </Box>
            );
          }
          return null;
        })()}

        <Divider sx={{ my: 2 }} />

        {/* Attachments */}
        <AttachmentsSection attachment={attachment} />

        {/* External Links */}
        <ExternalLinksSection
          links={externalLinks}
          onAdd={(link) => setExternalLinks((prev) => [...prev, link])}
          onEdit={(index, updatedLink) => setExternalLinks((prev) =>
            prev.map((l, i) => i === index ? updatedLink : l)
          )}
          onRemove={(index) => setExternalLinks((prev) => prev.filter((_, i) => i !== index))}
        />
      </Box>

      {/* Action Buttons */}
      <Box display="flex" gap={2} mt={6}>
        <Box sx={{ flex: 1 }} />
        {onSaveReport && (
          <Button
            variant="contained"
            color="primary"
            onClick={onSaveReport}
            disabled={isSubmitting}
            startIcon={isSubmitting ? <CircularProgress size={20} /> : <SaveIcon />}
          >
            {isSubmitting ? 'Saving...' : 'Save Report'}
          </Button>
        )}
        {/* In edit mode, show Save & Ban; otherwise show Next */}
        {isEditMode ? (
          onSaveAndBan && (
            <Button
              variant="contained"
              color="error"
              startIcon={<GavelIcon />}
              onClick={onSaveAndBan}
              disabled={isSubmitting}
            >
              Save &amp; Ban
            </Button>
          )
        ) : (
          <Button
            variant="contained"
            onClick={onNext}
            disabled={isSubmitting}
            endIcon={<NextIcon />}
          >
            Next
          </Button>
        )}
      </Box>
    </>
  );
};

export default StepReport;
