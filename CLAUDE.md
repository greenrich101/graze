# Graze

Tracks mob composition (head counts) and movements between paddocks so operators always know who is grazing where, now and historically.

## Tech Stack

- **Frontend:** React (web + mobile via responsive design)
- **Backend:** Supabase (auth, database, API)
- **Styling:** Tailwind CSS utility classes, neutral palette with subtle green accents
- **Offline:** Not supported (can be added later)

## Design Principles

- Operator-first: clean, utilitarian, fast. Clarity over decoration.
- Simple, readable UI — no heavy component frameworks or ornamental design.
- Card/list views, not geographic maps.

## Data Model

### Properties
- Name
- Multiple users per property (Supabase auth, role-based access)

### Paddocks
- Name
- Size (acres)
- Belongs to a property

### Mobs
- Name
- Description
- Head count (live, derived from composition)
- Current paddock
- Next planned paddock and move date
- Belongs to a property

### Animals / Mob Composition
- Breed
- Age class
- Category (bull, cow, calf, etc.)
- NLIS tag
- Description
- Belongs to a mob

### Movements
- Date
- Mob
- From paddock
- To paddock
- Notes
- Paddock requirements (set at move time, active while movement is open)

### Paddock Requirements
- Belong to a movement (not the mob or paddock)
- Selected from predefined requirement types (e.g. lick required, tub required, check water)
- Optional notes per requirement
- Active only while the movement is open — automatically disappear when the mob moves out
- Saved together with the movement in a single action

### Mob Splits & Merges
- Drafting head from one mob into another
- Combining two mobs into one
- Both operations recorded as movements with head-count adjustments

## Dashboard

- Each mob's current paddock
- Live head count per mob
- Days grazing in current paddock
- Active paddock requirements per mob (read-only checklist; "None active" if empty)
- Next planned paddock and move date
- Farm-level totals (total head, paddocks in use, etc.)

## Key Features

1. **Mob management** — create, edit, split, merge mobs
2. **Paddock management** — create, edit paddocks with name and size
3. **Movement recording** — log mob movements between paddocks with date, notes, and paddock requirements
4. **Next move planning** — schedule the next move (one upcoming move per mob)
5. **Dashboard** — daily operational checklist: mobs, paddocks, grazing status, and active requirements
6. **History** — movement history per mob and per paddock
7. **Multi-user** — multiple users per property via Supabase auth
