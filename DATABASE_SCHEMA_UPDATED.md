# Database Schema Reference (Updated After camelCase Migration)

## Overview

The OE AI Agent uses project-specific tables with the naming pattern `proj_{projectId}_{tableName}`.

**✅ All tables now use camelCase naming convention** after the database migration completed on February 11, 2026.

---

## Table Naming Convention

### Pattern
```
proj_{projectId}_{tableName}
```

### Examples
- `proj_390002_extractedFacts` (changed from extracted_facts)
- `proj_390002_documents`
- `proj_390002_redFlags` (changed from red_flags)

---

## Table Schemas

### 1. extractedFacts
**Table Name Pattern**: `proj_{projectId}_extractedFacts` ⚠️ Changed from `extracted_facts`

**Column Naming**: ⚠️ **Still using snake_case** (columns were NOT migrated)

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar(255) | Primary key |
| `project_id` | int(11) | ⚠️ snake_case - Project identifier |
| `category` | varchar(100) | Fact category (e.g., 'technical', 'financial') |
| `key` | varchar(255) | Fact key (e.g., 'dc_capacity', 'project_name') |
| `value` | text | Fact value |
| `data_type` | varchar(100) | ⚠️ snake_case - Data type |
| `confidence` | varchar(20) | Confidence level |
| `source_document_id` | varchar(255) | ⚠️ snake_case - Source document reference |
| `source_documents` | json | ⚠️ snake_case - Multiple source documents |
| `source_location` | text | ⚠️ snake_case - Location in source |
| `source_page` | int(11) | ⚠️ snake_case - Page number |
| `source_text_snippet` | text | ⚠️ snake_case - Extracted text snippet |
| `extraction_method` | varchar(50) | ⚠️ snake_case - Method used for extraction |
| `extraction_model` | varchar(100) | ⚠️ snake_case - Model used |
| `verified` | int(11) | Verification status (0/1) |
| `verification_status` | varchar(50) | ⚠️ snake_case - Status (pending, verified, rejected) |
| `enrichment_count` | int(11) | ⚠️ snake_case - Number of enrichments |
| `conflict_with` | varchar(36) | ⚠️ snake_case - Conflicting fact ID |
| `merged_from` | json | ⚠️ snake_case - Merged fact IDs |
| `last_enriched_at` | timestamp | ⚠️ snake_case - Last enrichment timestamp |
| `verified_by_user_id` | int(11) | ⚠️ snake_case - Verifying user |
| `verified_at` | datetime | ⚠️ snake_case - Verification timestamp |
| `created_at` | datetime | ⚠️ snake_case - Creation timestamp |
| `updated_at` | datetime | ⚠️ snake_case - Update timestamp |
| `deleted_at` | datetime | ⚠️ snake_case - Soft delete timestamp |
| `extracted_value` | text | ⚠️ snake_case - Legacy extracted value |

**Query Example**:
```sql
SELECT id, category, `key`, value, data_type, confidence, 
       source_document_id, extraction_method, verified, created_at
FROM proj_390002_extractedFacts
WHERE category = 'technical' AND `key` = 'dc_capacity'
ORDER BY created_at DESC;
```

---

### 2. documents
**Table Name Pattern**: `proj_{projectId}_documents`

**Column Naming**: ✅ **All camelCase**

| Column | Type | Description |
|--------|------|-------------|
| `id` | varchar(255) | Primary key |
| `fileName` | varchar(500) | ✅ camelCase |
| `filePath` | varchar(1000) | ✅ camelCase |
| `fileSizeBytes` | bigint(20) | ✅ camelCase |
| `fileHash` | varchar(64) | ✅ camelCase |
| `documentType` | varchar(100) | ✅ camelCase (e.g., 'IM', 'DD_PACK', 'CONTRACT') |
| `uploadDate` | datetime | ✅ camelCase |
| `status` | varchar(50) | Status (uploaded, processing, completed, failed) |
| `extractedText` | longtext | ✅ camelCase |
| `pageCount` | int(11) | ✅ camelCase |
| `createdAt` | datetime | ✅ camelCase |
| `updatedAt` | datetime | ✅ camelCase |
| `deletedAt` | datetime | ✅ camelCase |

**Query Example**:
```sql
SELECT id, fileName, documentType, status, pageCount, uploadDate
FROM proj_390002_documents
WHERE documentType = 'IM' AND status = 'completed'
ORDER BY uploadDate DESC;
```

---

### 3. redFlags
**Table Name Pattern**: `proj_{projectId}_redFlags`

**Column Naming**: ✅ **All camelCase**

| Column | Type | Description |
|--------|------|-------------|
| `id` | char(36) | Primary key (UUID) |
| `category` | enum | Category (Planning, Grid, Geotech, Performance, Scope, Commercial, Other) |
| `title` | varchar(255) | Red flag title |
| `description` | longtext | Detailed description |
| `severity` | enum | Severity (High, Medium, Low) |
| `triggerFactId` | varchar(36) | ✅ camelCase - Triggering fact reference |
| `evidenceGaps` | json | ✅ camelCase |
| `downstreamConsequences` | text | ✅ camelCase |
| `mitigated` | tinyint(1) | Mitigation status (0/1) |
| `mitigationNotes` | text | ✅ camelCase |
| `createdAt` | timestamp | ✅ camelCase |
| `updatedAt` | timestamp | ✅ camelCase |

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

## Migration Status

### ✅ Completed
- **Table names** migrated to camelCase
  - `extracted_facts` → `extractedFacts`
  - `red_flags` → `redFlags`
  - All other tables already used camelCase

### ⚠️ Partial (Not Completed)
- **Column names** in `extractedFacts` table remain snake_case
- `documents` and `redFlags` tables already had camelCase columns

### Code Compliance Status
✅ **All code updated** to use new table names:
- `query-tools.ts` - Updated all table references
- `generation-tools.ts` - Updated all table references
- `workflow-tools.ts` - Updated all table references
- `project-db-wrapper.ts` - Updated DEFAULT_TABLES array

---

## Important Notes

### 1. Table Name Changes
**Always use camelCase for table names:**
- ✅ `proj_390002_extractedFacts`
- ❌ `proj_390002_extracted_facts`

### 2. Column Name Inconsistency
**extractedFacts table still uses snake_case columns:**
```sql
-- CORRECT (current state)
SELECT project_id, data_type, source_document_id FROM proj_390002_extractedFacts

-- INCORRECT (not yet migrated)
SELECT projectId, dataType, sourceDocumentId FROM proj_390002_extractedFacts
```

### 3. Reserved Keywords
The `key` column in `extractedFacts` is a MySQL reserved keyword. Always use backticks:
```sql
SELECT `key`, value FROM proj_390002_extractedFacts
```

### 4. Project-Specific Table Wrapper
The `ProjectDbPool` wrapper automatically transforms table names:
```typescript
// You can write queries using short names
await projectDb.execute("SELECT * FROM extractedFacts WHERE project_id = ?", [projectId]);

// The wrapper automatically transforms to:
// SELECT * FROM proj_390002_extractedFacts WHERE project_id = ?
```

---

## Future Recommendations

### Complete the Migration
Migrate `extractedFacts` column names to camelCase to match other tables:

```sql
ALTER TABLE proj_390002_extractedFacts 
  CHANGE COLUMN project_id projectId int(11),
  CHANGE COLUMN data_type dataType varchar(100),
  CHANGE COLUMN source_document_id sourceDocumentId varchar(255),
  -- ... (see migration-audit.md for complete SQL)
```

Then update all queries in the codebase to use camelCase column names.

---

## Last Updated
February 11, 2026 - After camelCase table name migration

## Verified Against
- Database: TiDB Cloud (gateway02.us-east-1.prod.aws.tidbcloud.com)
- Project: 390002
- Tables: proj_390002_extractedFacts, proj_390002_documents, proj_390002_redFlags
