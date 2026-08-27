ALTER TABLE users
ADD COLUMN username TEXT,
ADD COLUMN password_hash TEXT;

CREATE UNIQUE INDEX users_username_lower_unique_idx
ON users (LOWER(username))
WHERE username IS NOT NULL;

UPDATE users
SET
  username = 'Jill',
  password_hash = crypt('admin', gen_salt('bf', 12)),
  updated_at = NOW()
WHERE email = 'jill@sterling.local'
  AND role = 'admin';

CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_sessions_user_id_idx
ON auth_sessions (user_id);

CREATE INDEX auth_sessions_expires_at_idx
ON auth_sessions (expires_at);
