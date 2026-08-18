import React, { useMemo, useState, useEffect } from 'react';
import { Grid, Box, Typography, Button, TextField, Select, MenuItem, FormControl, InputLabel, CircularProgress } from '@mui/material';
import { Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';
import { patronApi } from '../../../api/patrons';
import { parseApiError } from '../../../api/client';
import { Patron } from '../../../types';

interface SelectOption {
  value: string | number;
  label: string;
}

// TODO: Consider fetching from API endpoint when available
const AGE_RANGE_OPTIONS: SelectOption[] = [
  { value: 1, label: 'Unspecified' },
  { value: 2, label: 'Under 13 years' },
  { value: 3, label: '13-17 years' },
  { value: 4, label: '18-24 years' },
  { value: 5, label: '25-34 years' },
  { value: 6, label: '35-44 years' },
  { value: 7, label: '45-54 years' },
  { value: 8, label: '55+ years' },
];

// TODO: Confirm final list of gender options
const GENDER_OPTIONS: SelectOption[] = [
  { value: 'unspecified', label: 'Unspecified' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non-binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
  { value: 'prefer-not-to-say', label: 'Prefer not to say' },
];

const US_STATES: SelectOption[] = [
  { value: '', label: 'Select State' },
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' }, { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' }, { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' }, { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' }, { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' }, { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' }, { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' }, { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' }, { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' }, { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' }, { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' }, { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' }, { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' }, { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' }, { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' }, { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' }, { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' }, { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' }, { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' }, { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' }, { value: 'WY', label: 'Wyoming' },
];

export interface PatronInfoFormProps {
  patron: Patron;
  onUpdate: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  isEditing?: boolean;
  onEditStart?: () => void;
  onEditCancel?: () => void;
}

export const PatronInfoForm: React.FC<PatronInfoFormProps> = ({
  patron,
  onUpdate,
  onError,
  onSuccess,
  isEditing: externalIsEditing,
  onEditStart,
  onEditCancel,
}) => {
  const [internalIsEditing, setInternalIsEditing] = useState(false);
  const isEditing = externalIsEditing !== undefined ? externalIsEditing : internalIsEditing;
  const [isSaving, setIsSaving] = useState(false);

  const [editLibraryCard, setEditLibraryCard] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editAlias, setEditAlias] = useState('');
  const [editAgeRange, setEditAgeRange] = useState(1);
  const [editGender, setEditGender] = useState('unspecified');
  const [editAddressLine1, setEditAddressLine1] = useState('');
  const [editAddressLine2, setEditAddressLine2] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editState, setEditState] = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});

  const gender = useMemo(() => {
    const metadata = patron.metadata;
    if (!metadata) return 'unspecified';
    const parsedMetadata = typeof metadata === 'string'
      ? JSON.parse(metadata)
      : metadata;
    return (parsedMetadata as Record<string, unknown>).gender as string || 'unspecified';
  }, [patron]);

  const populateEditFields = () => {
    setEditLibraryCard(patron.library_card || '');
    setEditFirstName(patron.first_name || '');
    setEditLastName(patron.last_name || '');
    setEditAlias(patron.alias || '');
    setEditAgeRange(patron.age_range || 1);
    setEditGender(gender);
    setEditAddressLine1(patron.address_line1 || '');
    setEditAddressLine2(patron.address_line2 || '');
    setEditCity(patron.city || '');
    setEditState(patron.state_province || '');
    setEditPostalCode(patron.postal_code || '');
    setEditNotes(patron.notes || '');
  };

  const handleEdit = () => {
    populateEditFields();
    if (onEditStart) {
      onEditStart();
    } else {
      setInternalIsEditing(true);
    }
  };

  // Initialize form fields when entering edit mode
  useEffect(() => {
    if (isEditing) {
      populateEditFields();
    }
  }, [isEditing, patron, gender]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancel = () => {
    if (onEditCancel) {
      onEditCancel();
    } else {
      setInternalIsEditing(false);
    }
  };

  const handleSave = async () => {
    const newErrors: Record<string, string> = {};

    if (!editFirstName.trim()) {
      newErrors.first_name = 'First name is required';
    }
    if (editFirstName.length > 100) {
      newErrors.first_name = 'First name must be 100 characters or less';
    }
    if (editLastName.length > 100) {
      newErrors.last_name = 'Last name must be 100 characters or less';
    }
    if (editAlias && editAlias.length > 100) {
      newErrors.alias = 'Nickname/Alias must be 100 characters or less';
    }
    if (editPostalCode.trim() && !/^\d{5}(-\d{4})?$/.test(editPostalCode.trim())) {
      newErrors['postal_code'] = 'Enter a valid US ZIP code';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      onError('Please fix the validation errors');
      return;
    }

    setErrors({});
    setIsSaving(true);
    try {
      const metadata = patron.metadata;
      const currentMetadata = metadata
        ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata)
        : {};

      const newMetadata = {
        ...currentMetadata,
        gender: editGender === 'unspecified' ? null : editGender,
      };

      await patronApi.update(String(patron.id), {
        barcode: editLibraryCard,
        first_name: editFirstName,
        last_name: editLastName,
        alias: editAlias,
        age_range: Number(editAgeRange),
        metadata: newMetadata,
        address_line1: editAddressLine1.trim(),
        address_line2: editAddressLine2.trim(),
        city: editCity.trim(),
        state_province: editState,
        postal_code: editPostalCode.trim(),
        notes: editNotes,
      } as any);

      await onUpdate();
      onSuccess('Patron information updated');
      if (onEditCancel) {
        onEditCancel();
      } else {
        setInternalIsEditing(false);
      }
    } catch (err: any) {
      const { field, message } = parseApiError(err);
      if (field) {
        setErrors((prev) => ({ ...prev, [field]: message }));
        return;
      }
      onError(message || 'Failed to update patron information');
    } finally {
      setIsSaving(false);
    }
  };

  const formatAddress = () => {
    const parts: string[] = [];
    if (patron.address_line1) parts.push(patron.address_line1);
    if (patron.address_line2) parts.push(patron.address_line2);
    const cityStateZip = [patron.city, patron.state_province, patron.postal_code].filter(Boolean).join(', ');
    if (cityStateZip) parts.push(cityStateZip);
    return parts.length > 0 ? parts.join(', ') : 'Not set';
  };

  return (
    <Box>
      {isEditing ? (
        <Box>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="First Name"
                value={editFirstName}
                onChange={(e) => {
                  setEditFirstName(e.target.value);
                  if (errors.first_name) {
                    setErrors({ ...errors, first_name: '' });
                  }
                }}
                size="small"
                fullWidth
                required
                disabled={isSaving}
                error={!!errors.first_name}
                helperText={errors.first_name}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Last Name"
                value={editLastName}
                onChange={(e) => {
                  setEditLastName(e.target.value);
                  if (errors.last_name) {
                    setErrors({ ...errors, last_name: '' });
                  }
                }}
                size="small"
                fullWidth
                disabled={isSaving}
                error={!!errors.last_name}
                helperText={errors.last_name}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Nickname/Alias"
                value={editAlias}
                onChange={(e) => {
                  setEditAlias(e.target.value);
                  if (errors.alias) {
                    setErrors({ ...errors, alias: '' });
                  }
                }}
                size="small"
                fullWidth
                disabled={isSaving}
                error={!!errors.alias}
                helperText={errors.alias}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                label="Library Card"
                value={editLibraryCard}
                onChange={(e) => {
                  setEditLibraryCard(e.target.value);
                  if (errors.library_card) {
                    setErrors({ ...errors, library_card: '' });
                  }
                }}
                size="small"
                fullWidth
                disabled={isSaving}
                error={!!errors.library_card}
                helperText={errors.library_card}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl size="small" fullWidth disabled={isSaving}>
                <InputLabel>Age Range</InputLabel>
                <Select
                  label="Age Range"
                  value={editAgeRange}
                  onChange={(e) => setEditAgeRange(Number(e.target.value))}
                >
                  {AGE_RANGE_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl size="small" fullWidth disabled={isSaving}>
                <InputLabel>Gender</InputLabel>
                <Select
                  label="Gender"
                  value={editGender}
                  onChange={(e) => setEditGender(e.target.value)}
                >
                  {GENDER_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={12}>
              <TextField
                label="Address Line 1"
                value={editAddressLine1}
                onChange={(e) => setEditAddressLine1(e.target.value)}
                size="small"
                fullWidth
                disabled={isSaving}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                label="Address Line 2"
                value={editAddressLine2}
                onChange={(e) => setEditAddressLine2(e.target.value)}
                placeholder="Apt, Suite, Unit, etc. (optional)"
                size="small"
                fullWidth
                disabled={isSaving}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="City"
                value={editCity}
                onChange={(e) => setEditCity(e.target.value)}
                size="small"
                fullWidth
                disabled={isSaving}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl size="small" fullWidth disabled={isSaving}>
                <InputLabel>State</InputLabel>
                <Select
                  label="State"
                  value={editState}
                  onChange={(e) => setEditState(e.target.value)}
                >
                  {US_STATES.map((state) => (
                    <MenuItem key={state.value} value={state.value}>
                      {state.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <TextField
                label="ZIP Code"
                value={editPostalCode}
                onChange={(e) => setEditPostalCode(e.target.value)}
                placeholder="12345"
                size="small"
                fullWidth
                disabled={isSaving}
                error={!!errors['postal_code']}
                helperText={errors['postal_code']}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                label="Patron Notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Add notes or description about this patron..."
                size="small"
                fullWidth
                multiline
                rows={4}
                disabled={isSaving}
              />
            </Grid>
          </Grid>
          <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
            <Button
              variant="contained"
              startIcon={isSaving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={isSaving}
            >
              Save
            </Button>
            <Button
              variant="outlined"
              startIcon={<CancelIcon />}
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Typography variant="body2" color="text.secondary">First Name</Typography>
            <Typography variant="body2">
              {patron.first_name || <Typography component="span" color="text.disabled">—</Typography>}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Typography variant="body2" color="text.secondary">Last Name</Typography>
            <Typography variant="body2">
              {patron.last_name || <Typography component="span" color="text.disabled">—</Typography>}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Typography variant="body2" color="text.secondary">Nickname/Alias</Typography>
            <Typography variant="body2">
              {patron.alias || <Typography component="span" color="text.disabled">—</Typography>}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Typography variant="body2" color="text.secondary">Library Card</Typography>
            <Typography variant="body2">
              {patron.library_card || <Typography component="span" color="text.disabled">—</Typography>}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Typography variant="body2" color="text.secondary">Age Range</Typography>
            <Typography variant="body2">
              {AGE_RANGE_OPTIONS.find(opt => opt.value === patron.age_range)?.label ||
                <Typography component="span" color="text.disabled">—</Typography>}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Typography variant="body2" color="text.secondary">Gender</Typography>
            <Typography variant="body2">
              {GENDER_OPTIONS.find(opt => opt.value === gender)?.label ||
                <Typography component="span" color="text.disabled">—</Typography>}
            </Typography>
          </Grid>
          <Grid size={12}>
            <Typography variant="body2" color="text.secondary">Mailing Address</Typography>
            <Typography variant="body2">
              {formatAddress() === 'Not set' ?
                <Typography component="span" color="text.disabled">—</Typography> :
                formatAddress()}
            </Typography>
          </Grid>
          <Grid size={12}>
            <Typography variant="body2" color="text.secondary">Patron Notes</Typography>
            <Typography variant="body2">
              {patron.notes || <Typography component="span" color="text.disabled">—</Typography>}
            </Typography>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};

export default PatronInfoForm;
