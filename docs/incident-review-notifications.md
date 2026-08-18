# Incident Review Notifications

This document describes when and to whom notifications are sent during the incident review process.

**Related docs:**
- [Incident Review Chain](incident-review-chain.md) - How review chains work and permissions
- [Incident Roles](incident-roles.md) - What pages users can access

---

## Notification Events

| Event | Creates Review Entry | Sends Notification |
|-------|---------------------|-------------------|
| Save Report | No | No |
| Submit for Review | Yes (`submitted`) | Yes |
| Approve | Yes (`approved` / `approved-with-edits`) | Yes |
| Return for Edits | Yes (`returned`) | Yes |
| Delete | Yes (`deleted`) | No |
| Resolve | Yes (`resolved`) | No |
| Reopen | Yes (`reopened`) | Yes |

---

## Notification Recipients

### Submit for Review

When an incident is submitted (or resubmitted after being returned):

**Recipients**: All members of the **Level 1 review group** at the incident's location

```
Staff submits incident at Shoreline
  → Notify all users in Shoreline's Level 1 review group
```

### Approve (Forward to Next Level)

When a reviewer approves an incident:

**Recipients**: All members of the **next level's review group** at the incident's location

```
Level 1 reviewer approves
  → Notify all users in Level 2 review group

Level 2 reviewer approves
  → Notify all users in Level 3 review group (if exists)
```

### Return for Edits

When a reviewer returns an incident for changes:

**Recipients**: The **incident reporter (creator)**

```
Any reviewer returns incident
  → Notify the original creator only
```

### Reopen

When a final reviewer reopens a resolved incident:

**Recipients**: All members of the **Level 1 review group** at the incident's location

```
Final reviewer reopens resolved incident
  → Notify all users in Level 1 review group (same as new submission)
```

---

## No Notifications

The following actions do **not** send notifications:

- **Save Report** - Just saving changes, no review action
- **Delete** - Incident is removed, no further action needed
- **Resolve** - Final action, review process complete

---

## Template Codes

Each notification event uses a specific template:

| Event | Template Code |
|-------|---------------|
| Submit for Review | `incident-review-pending` |
| Approve (forward) | `incident-review-pending` |
| Return for Edits | `incident-review-returned` |
| Reopen | `incident-review-reopened` |

---

## Technical Details

### How Recipients Are Determined

1. Get the incident's `org_unit`
2. Look up `review_chain` for that org_unit at the target level
3. Get the `reviewer_group` from that chain entry
4. Query all users in `review_group_member` for that group
