Sterling Spend — simpler development/demo controls

- Login shows only RESET APP and LOAD DEMO DATA.
- RESET APP performs the existing full development reset while preserving admin access internally.
- RESET APP turns demo mode off, so no quick-login bubbles appear.
- LOAD DEMO DATA turns demo mode on.
- While demo mode is on, every active user with a username appears as a quick-login bubble.
- Users added later while demo mode is on also appear as bubbles.
- Demo mode persists through ordinary data/user edits and ends only when RESET APP is used.
- Development-only; production routes remain unavailable.
- No migration.
