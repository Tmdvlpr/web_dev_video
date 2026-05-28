ALTER TABLE workspace_members
    ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ NULL;
