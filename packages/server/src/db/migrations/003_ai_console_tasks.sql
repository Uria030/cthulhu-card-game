-- ============================================
-- Migration 003: AI Console Tasks (MOD-12)
-- Stores Uria's AI-driven module invocations.
-- FK points to admin_users (not a non-existent `users`).
-- ============================================

CREATE TABLE IF NOT EXISTS ai_console_tasks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,

  module_code        VARCHAR(16) NOT NULL,
  user_prompt        TEXT NOT NULL,
  attached_text      TEXT,
  context_tags       TEXT[] NOT NULL DEFAULT '{}',

  ai_model           VARCHAR(32) NOT NULL,
  ai_response        JSONB,

  status             VARCHAR(16) NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),

  artifacts_created  JSONB NOT NULL DEFAULT '[]',
  error_message      TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_user       ON ai_console_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status     ON ai_console_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_module     ON ai_console_tasks(module_code);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_created    ON ai_console_tasks(created_at DESC);
