-- AI Agent Module Database Migration
-- Version: 1.1
-- Date: 2026-02-12
-- Description: Adds tool_call_id column to agent_messages for proper OpenAI tool response tracking

-- Add tool_call_id column to agent_messages
-- This column stores the tool_call_id from OpenAI's tool calling API,
-- linking tool response messages to their corresponding tool_calls in the assistant message.
ALTER TABLE agent_messages
  ADD COLUMN tool_call_id VARCHAR(100) DEFAULT NULL
  AFTER tool_calls;

-- Remove unique constraint on user_id in agent_style_models (if it exists)
-- This allows multiple style model versions per user
-- Note: This is safe to run even if the constraint doesn't exist
SET @dbname = DATABASE();
SET @tablename = 'agent_style_models';
SET @constraintname = 'user_id';

SELECT IF(
  EXISTS(
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME = @tablename
    AND CONSTRAINT_NAME = @constraintname
    AND CONSTRAINT_TYPE = 'UNIQUE'
  ),
  CONCAT('ALTER TABLE ', @tablename, ' DROP INDEX ', @constraintname),
  'SELECT 1'
) INTO @sql;

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
