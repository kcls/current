import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Paper,
  IconButton,
  Tooltip,
  Typography,
  Alert,
  CircularProgress,
  Chip,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  DragIndicator as DragIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { reviewChainApi, reviewGroupApi } from '../../../api/review-chain';
import { staffApi } from '../../../api/staff';
import { useToast } from '../../../contexts/toast-context';
import { StaffSearch, StaffOption } from '../../../shared/components/staff-search';
import type { ReviewChainEntry, ReviewGroupMember } from '../../../types';

// StaffOption.id carries the user's uuid — the reference the review-chain
// API keys members on.
interface StaffMemberOption extends StaffOption {
  username?: string;
}

interface ReviewChainMemberInput {
  uuid: string;
  display_name?: string;
}

interface ReviewChainListProps {
  orgUnit: string;
  orgUnitName: string;
}

interface LevelWithMembers {
  // For existing levels from DB
  id?: number;
  reviewer_group?: number;
  review_level: number;
  is_final: boolean;
  require_peer_review: boolean;
  // Local state
  tempId: string; // Always present for React keys
  members: Array<{
    id?: number;
    usr: string;
    usr_display_name?: string;
    isNew?: boolean;
  }>;
  hasError?: boolean;
  isNew?: boolean;
}

interface SortableItemProps {
  level: LevelWithMembers;
  index: number;
  isLast: boolean;
  onDelete: (tempId: string) => void;
  onAddMember: (tempId: string, member: ReviewChainMemberInput) => void;
  onRemoveMember: (tempId: string, usrId: string) => void;
  onTogglePeerReview: (tempId: string, value: boolean) => void;
}

const SortableItem: React.FC<SortableItemProps> = ({
  level,
  index,
  isLast,
  onDelete,
  onAddMember,
  onRemoveMember,
  onTogglePeerReview,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: level.tempId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSearchStaff = async (query: string): Promise<StaffMemberOption[]> => {
    const results = await staffApi.search({ query, is_active: true, limit: 20 });
    return results.items.map((u) => ({
      id: u.uuid,
      display_name: u.display_name || '',
      email: u.email,
    }));
  };

  // Convert level.members to StaffMemberOption[] for StaffSearch value
  const currentMembers: StaffMemberOption[] = level.members.map((m) => ({
    id: m.usr,
    display_name: m.usr_display_name || `User #${m.usr}`,
    email: undefined,
  }));

  const handleStaffChange = (newValue: StaffMemberOption[]) => {
    const currentIds = new Set(level.members.map((m) => m.usr));
    const newIds = new Set(newValue.map((v) => v.id));

    // Find added members
    for (const staff of newValue) {
      if (!currentIds.has(staff.id as string)) {
        onAddMember(level.tempId, {
          uuid: staff.id as string,
          display_name: staff.display_name,
        });
      }
    }

    // Find removed members
    for (const member of level.members) {
      if (!newIds.has(member.usr)) {
        onRemoveMember(level.tempId, member.usr);
      }
    }
  };

  return (
    <Paper
      ref={setNodeRef}
      style={style}
      sx={{ mb: 2, p: 2 }}
      elevation={isDragging ? 4 : 1}
    >
      {/* Level header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Box
          {...attributes}
          {...listeners}
          sx={{
            cursor: 'grab',
            display: 'flex',
            alignItems: 'center',
            mr: 2,
            color: 'text.secondary',
            '&:hover': { color: 'text.primary' },
          }}
        >
          <DragIcon />
        </Box>

        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
            Level {index + 1}
          </Typography>
        </Box>

        {isLast && (
          <Chip
            label="Resolver"
            size="small"
            color="primary"
            sx={{ mr: 2 }}
          />
        )}

        <Tooltip title="Delete level">
          <IconButton size="small" color="error" onClick={() => onDelete(level.tempId)}>
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <StaffSearch<StaffMemberOption>
        label="Search for staff members"
        placeholder="Type to search by name, username, or email..."
        value={currentMembers}
        onChange={handleStaffChange}
        onSearch={handleSearchStaff}
        getSecondaryText={(option) => option.email || ''}
        multiple
        error={level.hasError}
        helperText={level.hasError ? 'At least one reviewer required' : undefined}
      />

      {!isLast && (
        <Box sx={{ mt: 1, pl: 1.25 }}>
          <Tooltip
            title={
              level.members.length <= 1
                ? 'Requires at least 2 reviewers in this group'
                : 'When a reviewer submits their own report, this keeps the report at their level so another reviewer here must approve it — instead of auto-skipping to the next level'
            }
          >
            <span>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={level.require_peer_review}
                    disabled={level.members.length <= 1}
                    onChange={(e) => onTogglePeerReview(level.tempId, e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2" color="text.secondary">
                    Hold for peer review when a reviewer submits their own report
                  </Typography>
                }
              />
            </span>
          </Tooltip>
        </Box>
      )}
    </Paper>
  );
};

export const ReviewChainList: React.FC<ReviewChainListProps> = ({ orgUnit, orgUnitName }) => {
  const { showSuccess, showError } = useToast();
  const [levels, setLevels] = useState<LevelWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const entries = await reviewChainApi.list(orgUnit);
      entries.sort((a: ReviewChainEntry, b: ReviewChainEntry) => a.review_level - b.review_level);

      const levelsWithMembers: LevelWithMembers[] = await Promise.all(
        entries.map(async (entry: ReviewChainEntry) => {
          try {
            const groupData = await reviewGroupApi.get(entry.reviewer_group);
            return {
              id: entry.id,
              reviewer_group: entry.reviewer_group,
              review_level: entry.review_level,
              is_final: entry.is_final,
              require_peer_review: entry.require_peer_review ?? false,
              tempId: `existing-${entry.id}`,
              members: (groupData.members || []).map((m: ReviewGroupMember) => ({
                id: m.id,
                usr: m.usr,
                usr_display_name: m.usr_display_name,
              })),
            };
          } catch {
            return {
              id: entry.id,
              reviewer_group: entry.reviewer_group,
              review_level: entry.review_level,
              is_final: entry.is_final,
              require_peer_review: entry.require_peer_review ?? false,
              tempId: `existing-${entry.id}`,
              members: [],
            };
          }
        })
      );

      setLevels(levelsWithMembers);
      setIsDirty(false);
    } catch (err: any) {
      setError(err.message || 'Failed to load review chain');
    } finally {
      setLoading(false);
    }
  }, [orgUnit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Add level locally (no API call)
  const handleAddLevel = () => {
    const newLevel: LevelWithMembers = {
      tempId: `new-${Date.now()}`,
      review_level: levels.length + 1,
      is_final: false,
      require_peer_review: false,
      members: [],
      isNew: true,
    };
    setLevels((prev) => [...prev, newLevel]);
    setIsDirty(true);
  };

  const handleDeleteLevel = (tempId: string) => {
    const levelIndex = levels.findIndex((l) => l.tempId === tempId);
    if (levelIndex === -1) return;

    const level = levels[levelIndex]!;
    const memberCount = level.members.length;
    const message = memberCount > 0
      ? `Delete Level ${levelIndex + 1}? This will remove ${memberCount} reviewer${memberCount > 1 ? 's' : ''}.`
      : `Delete Level ${levelIndex + 1}?`;

    if (window.confirm(message)) {
      setLevels((prev) => prev.filter((l) => l.tempId !== tempId));
      setIsDirty(true);
    }
  };

  // Add member locally (no API call)
  const handleAddMember = (tempId: string, member: ReviewChainMemberInput) => {
    setLevels((prev) =>
      prev.map((l) =>
        l.tempId === tempId
          ? {
              ...l,
              hasError: false,
              members: [
                ...l.members,
                {
                  usr: member.uuid,
                  usr_display_name: member.display_name,
                  isNew: true,
                },
              ],
            }
          : l
      )
    );
    setIsDirty(true);
  };

  // Remove member locally (no API call)
  // Auto-disables require_peer_review if member count drops to 1
  const handleRemoveMember = (tempId: string, usrId: string) => {
    setLevels((prev) =>
      prev.map((l) => {
        if (l.tempId !== tempId) return l;
        const newMembers = l.members.filter((m) => m.usr !== usrId);
        return {
          ...l,
          members: newMembers,
          require_peer_review: newMembers.length <= 1 ? false : l.require_peer_review,
        };
      })
    );
    setIsDirty(true);
  };

  const handleTogglePeerReview = (tempId: string, value: boolean) => {
    setLevels((prev) =>
      prev.map((l) =>
        l.tempId === tempId ? { ...l, require_peer_review: value } : l
      )
    );
    setIsDirty(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = levels.findIndex((l) => l.tempId === active.id);
    const newIndex = levels.findIndex((l) => l.tempId === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    setLevels(arrayMove(levels, oldIndex, newIndex));
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (levels.length === 0) {
      setValidationError('Please add at least one review level');
      return;
    }

    // Validate that each level has at least one reviewer
    const emptyLevels = levels.filter((level) => level.members.length === 0);

    if (emptyLevels.length > 0) {
      const emptyTempIds = new Set(emptyLevels.map((l) => l.tempId));
      setLevels((prev) =>
        prev.map((l) => ({
          ...l,
          hasError: emptyTempIds.has(l.tempId),
        }))
      );
      return;
    }

    try {
      setSaving(true);
      setValidationError(null);
      setLevels((prev) => prev.map((l) => ({ ...l, hasError: false })));

      const payload = levels.map((level) => ({
        id: level.id,
        reviewer_group: level.reviewer_group,
        require_peer_review: level.require_peer_review,
        members: level.members.map((m) => ({ usr: m.usr })),
      }));

      await reviewChainApi.save(orgUnit, payload);

      showSuccess('Review chain saved');
      await fetchData();
    } catch (err: any) {
      console.error('Save failed:', err);

      if (err?.code === 'BLOCKED_BY_IN_FLIGHT_INCIDENTS' && err?.details?.affected_incidents) {
        const incidents = err.details.affected_incidents;
        const incidentList = incidents
          .slice(0, 10)
          .map((inc: { id: number; title?: string }) =>
            `• #${inc.id}${inc.title ? `: ${inc.title}` : ''}`
          )
          .join('\n');

        const moreCount = incidents.length > 10 ? `\n... and ${incidents.length - 10} more` : '';

        setValidationError(
          `Cannot reduce review chain. The following incident(s) are waiting for review at a level that would be removed:\n\n` +
          `${incidentList}${moreCount}\n\n` +
          `Please approve or resolve these incidents first before removing review levels.`
        );
      } else {
        setValidationError(err.message || 'Failed to save review chain');
        showError('Failed to save review chain');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Review Chain for {orgUnitName}</Typography>
        {saving && <CircularProgress size={20} />}
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Drag to reorder levels. The last level is automatically the resolver (final reviewer).
      </Typography>

      {validationError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setValidationError(null)}>
          <Box sx={{ whiteSpace: 'pre-wrap' }}>{validationError}</Box>
        </Alert>
      )}

      {levels.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          No review chain configured. Add a review level to get started.
        </Alert>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={levels.map((l) => l.tempId)}
            strategy={verticalListSortingStrategy}
          >
            <Box sx={{ mb: 2 }}>
              {levels.map((level, index) => (
                <SortableItem
                  key={level.tempId}
                  level={level}
                  index={index}
                  isLast={index === levels.length - 1}
                  onDelete={handleDeleteLevel}
                  onAddMember={handleAddMember}
                  onRemoveMember={handleRemoveMember}
                  onTogglePeerReview={handleTogglePeerReview}
                />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}

      <Box sx={{ display: 'flex', gap: 2, mt: 4 }}>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={handleAddLevel}
          disabled={saving}
        >
          Add Reviewer Group
        </Button>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving || (!isDirty && levels.length > 0)}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
};
