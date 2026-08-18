# Incident Review Chain

Every incident goes through review before it can be closed. The
**review chain** determines who reviews incidents at each location, and
in what order.

## Roles vs. the review chain

These are two separate things:

| Concept | What it controls | Example |
|---------|-----------------|---------|
| **Role** | Which pages and features you can use | The staff role lets you open the Reviews page |
| **Review chain** | Whether you can act on a particular incident | A level 2 reviewer can approve incidents waiting at levels 1–2 |

One exception: users with the `incident-admin` role are treated as
final reviewers everywhere, even when they're not in any chain. When
one of them submits or approves an incident, it resolves immediately.

## How it works

1. A manager or admin configures a review chain for each location: who
   reviews at level 1, level 2, and so on, with the top level marked
   **final**.
2. Staff create an incident at a location and submit it for review.
3. Each level approves in turn, moving the incident up the chain.
4. The final reviewer either **resolves** the incident (closes it) or
   **returns** it to the reporter for edits.

**Location matters.** The chain that applies is the one configured for
the location *where the incident happened* — not where the reviewer
works. The same person might be a level 2 reviewer at one branch and
not a reviewer at all at another.

Each location needs its own chain; nothing is inherited from parent
locations. A location without a chain cannot submit incidents for
review — the submit button is disabled until a chain is configured.

## Setting up a chain

Each level is assigned to a **review group** — a named group of one or
more people, any of whom can act on incidents waiting at that level.

A large branch might use three levels, a small branch two:

| Level | Review group | Final? |
|-------|--------------|--------|
| 1 | Branch Managers | No |
| 2 | Regional Managers | No |
| 3 | Coordinators | Yes |

### Peer review (optional, per level)

Normally, when reviewers submit their *own* incident, it skips past
their level so they can't approve their own report. Turning **peer
review** on for a level changes this: the incident stays at their
level, but a *different* member of the group must approve it.

Enable it when a level has at least two members and you want every
report — including reviewers' own — approved by a colleague. (It turns
itself off if the group drops to one member, and never applies to the
final level.)

## Who can do what

**Submitting.** The incident's reporter, anyone in the location's
review chain, and `incident-admin` users can submit a draft for review.
Submissions by a reviewer skip their own level (unless peer review
holds them there); submissions by a final reviewer or an
`incident-admin` resolve the incident immediately.

**Approving.** A reviewer at level N can act on any incident waiting at
level N or below. Approval moves the incident to the level just above
the *reviewer's* — so a senior reviewer approving an early-stage
incident pulls it past the intermediate levels.

**Resolving and returning.** Final reviewers don't approve; they make
the closing call. **Resolve** closes the incident — the only way an
incident gets closed. **Return** (available to every reviewer) sends it
back to the reporter as a draft, with notes; the reporter fixes it up
and resubmits.

**Reopening.** Final reviewers and `incident-admin` users can reopen a
resolved incident, which sends it back to level 1 for a full re-review.

### A typical journey

1. Staff member submits an incident → waits at level 1
2. Branch manager approves → waits at level 2
3. Regional manager returns it with notes → back to the reporter
4. Reporter revises and resubmits → level 1 again
5. Branch manager approves, then the coordinator (final) resolves it

## Changing a chain while incidents are in review

Review follows the **level number**, not the person — so reorganizing
groups doesn't invalidate anything already in flight:

| Change | Effect on in-flight incidents |
|--------|-------------------------------|
| Add levels | None; only future incidents use the new levels |
| Swap people between levels | Whoever now holds the level takes over its waiting incidents |
| Empty out a level's group | Higher-level reviewers can still act on its incidents |
| Remove levels | Blocked while incidents are waiting at those levels — resolve them first |

## Common questions

| Question | Answer |
|----------|--------|
| Can one person review at multiple locations? | Yes — add them to each location's review chain. |
| Can a reviewer submit someone else's draft? | Yes. Anyone in the chain can submit any draft at that location; the usual skip/peer-review rules apply. |
| I'm in the chain but can't open the Reviews page | The chain doesn't grant page access — you also need the staff role (see [Roles](incident-roles.md)). |
| Why can't anyone close this incident? | Only the final reviewer (or an `incident-admin`) can resolve. If the chain has no reachable final level, a manager needs to fix the chain. |
