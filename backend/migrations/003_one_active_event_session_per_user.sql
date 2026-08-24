CREATE UNIQUE INDEX event_sessions_one_active_per_user_idx
ON event_sessions (user_id)
WHERE ended_at IS NULL;
