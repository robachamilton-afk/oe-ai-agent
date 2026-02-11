# Database Schema Reference

## Overview

The OE AI Agent uses project-specific tables with the naming pattern `proj_{projectId}_{tableName}`.

**Important**: The database uses **mixed naming conventions** - some tables use snake_case, others use camelCase. This document provides the authoritative reference for all table and column names.

---

## Table Naming Conventions

### Pattern
```
proj_{projectId}_{tableName}
```

### Examples
- `proj_390002_extracted_facts`
- `proj_390002_documents`
- `proj_390002_redFlags` ← Note: camelCase

---

## Table Schemas

### 1. extracted_facts
**Naming Convention**: snake_case
**Table Name Pattern**: `proj_{projectId}_extracted_facts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar(255) | Primary key |
| `project_id` | int(11) | Project identifier |
| `category` | varchar(100) | Fact category (e.g., 'technical', 'financial') |
| `key` | varchar(255) | Fact key (e.g., 'dc_capacity', 'project_name') |
| `value` | text | Fact value |
| `data_type` | varchar(100) | Data type |
| `confidence` | varchar(20) | Confidence level |
| `source_document_id` | varchar(255) | Source document reference |
| `source_documents` | json | Multiple source documents |
| `source_location` | text | Location in source |
| `source_page` | int(11) | Page number |
| `source_text_snippet` | text | Extracted text snippet |
| `extraction_method` | varchar(50) | Method used for extraction |
| `extraction_model` | varchar(100) | Model used |
| `verified` | int(11) | Verification status (0/1) |
| `verification_status` | varchar(50) | Status (pending, verified, rejected) |
| `enrichment_count` | int(11) | Number of enrichments |
| `conflict_with` | varchar(36) | Conflicting fact ID |
| `merged_from` | json | Merged fact IDs |
| `last_enriched_at` | timestamp | Last enrichment timestamp |
| `verified_by_user_id` | int(11) | Verifying user |
| `verified_at` | datetime | Verification timestamp |
| `created_at` | datetime | Creation timestamp |
| `updated_at` | datetime | Update timestamp |
| `deleted_at` | datetime | Soft delete timestamp |
| `extracted_value` | text | Legacy extracted value |

**Query Example**:
```sql
SELECT id, category, `key`, value, data_type, confidence, 
       source_document_id, extraction_method, verified, created_at
FROM proj_390002_extracted_facts
WHERE category = 'technical' AND `key` = 'dc_capacity'
ORDER BY created_at DESC;
```

---

### 2. documents
**Naming Convention**: camelCase
**Table Name Pattern**: `proj_{projectId}_documents`

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar(255) | Primary key |
| `fileName` | varchar(500) | ⚠️ camelCase |
| `filePath` | varchar(1000) | ⚠️ camelCase |
| `fileSizeBytes` | bigint(20) | ⚠️ camelCase |
| `fileHash` | varchar(64) | ⚠️ camelCase |
| `documentType` | varchar(100) | ⚠️ camelCase (e.g., 'IM', 'DD_PACK', 'CONTRACT') |
| `uploadDate` | datetime | ⚠️ camelCase |
| `status` | varchar(50) | Status (uploaded, processing, completed, failed) |
| `extractedText` | longtext | ⚠️ camelCase |
| `pageCount` | int(11) | ⚠️ camelCase |
| `createdAt` | datetime | ⚠️ camelCase |
| `updatedAt` | datetime | ⚠️ camelCase |
| `deletedAt` | datetime | ⚠️ camelCase |

**Query Example**:
```sql
SELECT id, fileName, documentType, status, pageCount, uploadDate
FROM proj_390002_documents
WHERE documentType = 'IM' AND status = 'completed'
ORDER BY uploadDate DESC;
```

---

### 3. redFlags
**Naming Convention**: camelCase
**Table Name Pattern**: `proj_{projectId}_redFlags` ⚠️ Note: redFlags, not red_flags

| Column | Type | Description |
|--------|------|-------------|
| `id` | char(36) | Primary key (UUID) |
| `category` | enum | Category (Planning, Grid, Geotech, Performance, Scope, Commercial, Other) |
| `title` | varchar(255) | Red flag title |
| `description` | longtext | Detailed description |
| `severity` | enum | Severity (High, Medium, Low) |
| `triggerFactId` | varchar(36) | ⚠️ camelCase - Triggering fact reference |
| `evidenceGaps` | json | ⚠️ camelCase |
| `downstreamConsequences` | text | ⚠️ camelCase |
| `mitigated` | tinyint(1) | Mitigation status (0/1) |
| `mitigationNotes` | text | ⚠️ camelCase |
| `createdAt` | timestamp | ⚠️ camelCase |
| `updatedAt` | timestamp | ⚠️ camelCase |

**Query Example**:
```sql
SELECT id, category, title, description, severity, 
       triggerFactId, downstreamConsequences, mitigated, createdAt
FROM proj_390002_redFlags
WHERE severity = 'High' AND mitigated = 0
ORDER BY CASE severity
  WHEN 'High' THEN 1
  WHEN 'Medium' THEN 2
  WHEN 'Low' THEN 3
END, createdAt DESC;
```

---

## Common Query Patterns

### Query Facts by Category
```sql
SELECT id, category, `key`, value, confidence
FROM proj_{projectId}_extracted_facts
WHERE category = ?
ORDER BY created_at DESC
LIMIT 50;
```

### Query Facts by Key
```sql
SELECT id, category, `key`, value, confidence
FROM proj_{projectId}_extracted_facts
WHERE `key` = ?
ORDER BY created_at DESC
LIMIT 50;
```

### Search Facts by Value
```sql
SELECT id, category, `key`, value, confidence
FROM proj_{projectId}_extracted_facts
WHERE value LIKE ?
ORDER BY created_at DESC
LIMIT 50;
```

### Get Document Count by Type
```sql
SELECT documentType, COUNT(*) as count
FROM proj_{projectId}_documents
GROUP BY documentType;
```

### Get Red Flag Count by Severity
```sql
SELECT severity, COUNT(*) as count
FROM proj_{projectId}_redFlags
GROUP BY severity;
```

---

## Important Notes

### 1. Mixed Naming Conventions
The database uses **inconsistent naming conventions**:
- `extracted_facts`: All columns use snake_case
- `documents`: All columns use camelCase
- `redFlags`: Table name AND columns use camelCase

**Always refer to this document** when writing SQL queries to ensure correct column names.

### 2. Reserved Keywords
The `key` column in `extracted_facts` is a MySQL reserved keyword. Always use backticks:
```sql
SELECT `key`, value FROM proj_{projectId}_extracted_facts
```

### 3. Table Name Case Sensitivity
- `redFlags` is camelCase (NOT `red_flags`)
- `factVerificationQueue` is camelCase (NOT `fact_verification_queue`)
- `projectMetadata` is camelCase (NOT `project_metadata`)
- `processingLogs` is camelCase (NOT `processing_logs`)

### 4. Project ID Format
Project IDs are integers (e.g., 390002), not strings. When constructing table names:
```typescript
const tableName = `proj_${context.projectId}_extracted_facts`;
// Result: proj_390002_extracted_facts
```

---

## Schema Validation

When adding new query tools, always:

1. **Check this document** for correct table and column names
2. **Test queries** against actual database before deployment
3. **Use backticks** for reserved keywords like `key`
4. **Match case exactly** - SQL is case-sensitive for column names in some configurations

---

## Future Improvements

### Recommended
1. Standardize all tables to use either snake_case OR camelCase consistently
2. Add schema validation layer to catch naming mismatches at compile time
3. Use TypeScript types generated from actual database schema
4. Implement database migration versioning

### Migration Strategy
If standardizing to snake_case:
```sql
ALTER TABLE proj_{id}_documents RENAME COLUMN fileName TO file_name;
ALTER TABLE proj_{id}_documents RENAME COLUMN documentType TO document_type;
-- etc.
```

If standardizing to camelCase:
```sql
ALTER TABLE proj_{id}_extracted_facts RENAME COLUMN project_id TO projectId;
ALTER TABLE proj_{id}_extracted_facts RENAME COLUMN data_type TO dataType;
-- etc.
```

---

## Last Updated
February 11, 2026

## Verified Against
- Database: TiDB Cloud (gateway02.us-east-1.prod.aws.tidbcloud.com)
- Project: 390002
- Tables: proj_390002_extracted_facts, proj_390002_documents, proj_390002_redFlags
