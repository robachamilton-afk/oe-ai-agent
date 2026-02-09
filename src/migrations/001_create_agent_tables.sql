-- AI Agent Module Database Migration
-- Version: 1.0
-- Date: 2026-02-10
-- Description: Creates tables for AI agent conversations, learning, and style adaptation

-- Agent conversations table
CREATE TABLE IF NOT EXISTS agent_conversations (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  title VARCHAR(255),
  context JSON,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_user_project (user_id, project_id),
  INDEX idx_status (status),
  INDEX idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent messages table
CREATE TABLE IF NOT EXISTS agent_messages (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSON,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_conversation (conversation_id),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent actions log table
CREATE TABLE IF NOT EXISTS agent_actions (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36),
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  action_name VARCHAR(100) NOT NULL,
  input JSON,
  output JSON,
  success TINYINT(1) NOT NULL,
  error_message TEXT,
  execution_time_ms INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_user_project (user_id, project_id),
  INDEX idx_action_type (action_type),
  INDEX idx_created_at (created_at),
  INDEX idx_success (success)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent style models table
CREATE TABLE IF NOT EXISTS agent_style_models (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  version INT NOT NULL DEFAULT 1,
  patterns JSON,
  statistics JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_version (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent learning samples table
CREATE TABLE IF NOT EXISTS agent_learning_samples (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  content_type VARCHAR(50) NOT NULL,
  draft_content TEXT NOT NULL,
  final_content TEXT NOT NULL,
  extracted_patterns JSON,
  edit_distance INT,
  applied TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_content_type (content_type),
  INDEX idx_applied (applied),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent knowledge base table
CREATE TABLE IF NOT EXISTS agent_knowledge_base (
  id VARCHAR(36) PRIMARY KEY,
  category VARCHAR(100) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  confidence VARCHAR(20) DEFAULT 'medium',
  source_count INT DEFAULT 1,
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_category (category),
  INDEX idx_topic (topic),
  INDEX idx_confidence (confidence),
  FULLTEXT idx_content (content)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent generated content table
CREATE TABLE IF NOT EXISTS agent_generated_content (
  id VARCHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  conversation_id VARCHAR(36),
  content_type VARCHAR(50) NOT NULL,
  prompt TEXT NOT NULL,
  generated_content TEXT NOT NULL,
  final_content TEXT,
  accepted TINYINT(1),
  feedback TEXT,
  style_model_version INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_user_project (user_id, project_id),
  INDEX idx_content_type (content_type),
  INDEX idx_accepted (accepted),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert initial knowledge base entries
INSERT INTO agent_knowledge_base (id, category, topic, content, confidence, source_count) VALUES
(UUID(), 'domain_knowledge', 'Solar PV Performance Metrics', 'Key performance metrics for solar PV projects include: Capacity Factor (15-25% typical), Performance Ratio (75-85% typical), Specific Yield (1200-1800 kWh/kWp/year depending on location), and Annual Generation (calculated from DC capacity and irradiance).', 'high', 1),
(UUID(), 'domain_knowledge', 'Risk Assessment Framework', 'Risk assessment should consider: Technical risks (equipment performance, degradation), Financial risks (cost overruns, revenue shortfall), Environmental risks (weather, natural disasters), and Regulatory risks (policy changes, permitting delays).', 'high', 1),
(UUID(), 'best_practice', 'Document Classification', 'Documents should be classified according to ISO 19650 standards into categories: Information Memorandums (IM), Due Diligence Packs (DD_PACK), Contracts, Grid Studies, Concept Designs, Weather Files, and Other supporting documents.', 'high', 1),
(UUID(), 'best_practice', 'Fact Verification', 'All extracted facts should be verified against source documents. Critical facts (capacity, location, financial terms) require high confidence (>90%). Medium confidence facts (80-90%) should be flagged for review.', 'high', 1);
