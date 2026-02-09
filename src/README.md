# OE Ecosystem AI Agent Module

## Overview

The AI Agent Module is a reusable, embeddable intelligent assistant for the OE (Operational Excellence) ecosystem. It provides conversational interfaces for querying project data, generating technical content, and guiding users through workflows.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent Orchestrator                       │
│  Coordinates conversation, LLM calls, and tool execution     │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌───────▼────────┐  ┌──────▼──────┐
│ Conversation   │  │ Tool Executor  │  │  Learning   │
│   Manager      │  │                │  │   Engine    │
└────────────────┘  └────────────────┘  └─────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌───────▼────────┐  ┌──────▼──────┐
│  Query Tools   │  │Generation Tools│  │ Workflow    │
│                │  │                │  │   Tools     │
└────────────────┘  └────────────────┘  └─────────────┘
```

## Components

### 1. Agent Orchestrator (`agent-orchestrator.ts`)
Main coordinator that processes user messages, manages LLM interactions, and executes tools.

**Key Methods:**
- `processMessage(request)` - Process user message and generate response
- `getConversationHistory(conversationId)` - Retrieve conversation messages
- `submitEdit(contentId, finalContent)` - Submit user edits for learning

### 2. Conversation Manager (`conversation-manager.ts`)
Manages multi-turn conversation state and message history.

**Key Methods:**
- `createConversation(params)` - Create new conversation
- `addMessage(params)` - Add message to conversation
- `getMessages(conversationId)` - Get conversation messages
- `buildLLMContext(conversationId)` - Build context for LLM

### 3. Tool Executor (`tool-executor.ts`)
Executes agent actions with validation and logging.

**Key Methods:**
- `registerTool(tool)` - Register a tool
- `executeTool(toolName, args, context)` - Execute a tool
- `getToolDefinitions()` - Get LLM-compatible tool definitions

### 4. Learning Engine (`learning-engine.ts`)
Analyzes user edits and updates style models.

**Key Methods:**
- `submitEdit(contentId, finalContent, feedback)` - Process user edit
- `getStyleModel(userId)` - Get user's style patterns
- `getLearningStats(userId)` - Get learning statistics

## Tools

### Query Tools (`tools/query-tools.ts`)
- `query_facts` - Query extracted facts with filters
- `query_documents` - Query project documents
- `query_red_flags` - Query identified risks
- `get_fact_by_id` - Get detailed fact information
- `get_project_summary` - Get project overview

### Generation Tools (`tools/generation-tools.ts`)
- `generate_risk_narrative` - Generate risk assessment narrative
- `generate_project_summary` - Generate executive summary
- `generate_technical_specification` - Generate technical spec document

### Workflow Tools (`tools/workflow-tools.ts`)
- `get_workflow_status` - Check workflow progress
- `suggest_next_actions` - Suggest recommended actions
- `identify_missing_data` - Find missing data fields
- `validate_project_completeness` - Validate project readiness

## API Endpoints (tRPC)

### `agent.chat`
Send a message to the agent.

**Input:**
```typescript
{
  projectId: number;
  conversationId?: string;
  message: string;
  context?: {
    currentPage?: string;
    workflowStage?: string;
    relevantDocuments?: string[];
    relevantFacts?: string[];
  };
}
```

**Output:**
```typescript
{
  conversationId: string;
  message: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result: unknown;
  }>;
  metadata: {
    tokens?: number;
    model?: string;
    latency: number;
    toolsUsed: string[];
  };
}
```

### `agent.getConversations`
Get all conversations for a project.

**Input:**
```typescript
{
  projectId: number;
}
```

**Output:**
```typescript
{
  conversations: AgentConversation[];
}
```

### `agent.submitEdit`
Submit user edit for learning.

**Input:**
```typescript
{
  contentId: string;
  finalContent: string;
  feedback?: string;
}
```

**Output:**
```typescript
{
  success: boolean;
}
```

### `agent.getLearningStats`
Get learning statistics for current user.

**Output:**
```typescript
{
  totalEdits: number;
  totalGenerations: number;
  averageEditDistance: number;
  improvementScore: number;
  styleModelVersion: number;
}
```

## Database Schema

### `agent_conversations`
Stores conversation metadata and context.

### `agent_messages`
Individual messages within conversations.

### `agent_actions`
Audit log of all agent operations.

### `agent_style_models`
User-specific writing style patterns.

### `agent_learning_samples`
Draft vs final content comparisons.

### `agent_knowledge_base`
De-identified cross-project insights.

### `agent_generated_content`
Tracking for generated content and learning.

## Usage Examples

### Frontend Integration

```typescript
import { trpc } from './trpc';

// Send a message
const response = await trpc.agent.chat.mutate({
  projectId: 123,
  message: "What are the high-risk facts in this project?",
});

console.log(response.message);
console.log(response.toolsUsed); // ['query_red_flags']

// Get conversations
const { conversations } = await trpc.agent.getConversations.query({
  projectId: 123,
});

// Submit edit for learning
await trpc.agent.submitEdit.mutate({
  contentId: "abc-123",
  finalContent: "Updated content with user edits...",
  feedback: "More technical depth needed",
});
```

### Backend Integration

```typescript
import { AgentOrchestrator } from './agent/agent-orchestrator';
import { getDb } from './db';
import { createProjectDbConnection } from './db-connection';

const db = await getDb();
const orchestrator = new AgentOrchestrator(db, async (projectId) => {
  return await createProjectDbConnection(projectId);
});

const response = await orchestrator.processMessage({
  userId: 1,
  projectId: 123,
  message: "Generate a risk assessment for fact #456",
});

console.log(response.message);
```

## Adding New Tools

To add a new tool:

1. Create tool definition in appropriate file (e.g., `tools/custom-tools.ts`):

```typescript
import type { ToolDefinition } from "../tool-executor";

export const myCustomTool: ToolDefinition = {
  name: "my_custom_tool",
  description: "Description of what the tool does",
  parameters: {
    type: "object",
    properties: {
      param1: {
        type: "string",
        description: "Description of param1",
      },
    },
    required: ["param1"],
  },
  handler: async (args, context) => {
    // Tool implementation
    const result = await doSomething(args.param1);
    return result;
  },
};
```

2. Register tool in `agent-orchestrator.ts`:

```typescript
import { myCustomTool } from "./tools/custom-tools";

// In constructor
this.toolExecutor.registerTool(myCustomTool);
```

## Learning System

The agent learns from user edits to improve content generation:

1. **Content Generation**: Agent generates content with current style model
2. **User Edit**: User modifies generated content
3. **Edit Analysis**: Learning engine analyzes differences
4. **Pattern Extraction**: Extracts style patterns and preferences
5. **Model Update**: Updates user's style model
6. **Improvement**: Future generations apply learned patterns

### Style Patterns Tracked

- Sentence structure preferences
- Technical depth (high/medium/low)
- Risk framing style (conservative/balanced/optimistic)
- Terminology preferences
- Format preferences

## Performance Considerations

### Response Times
- Simple queries: <2 seconds
- Complex analysis: <10 seconds
- Content generation: <15 seconds

### Optimization Tips
1. Use conversation context to reduce redundant queries
2. Cache frequently accessed project data
3. Batch tool executions when possible
4. Limit conversation history to recent messages

## Security & Privacy

### Data Isolation
- Project data strictly isolated by `projectId`
- Row-level security enforced at database level
- All queries scoped to current project

### Audit Trail
- All agent actions logged with timestamps
- Tool executions tracked with input/output
- User edits recorded for learning

### De-identification
- Cross-project learning uses de-identified data
- No project-specific identifiers in shared knowledge base
- Style models are user-specific, not shared

## Testing

### Unit Tests
```bash
# Run tests for specific components
npm test server/agent/conversation-manager.test.ts
npm test server/agent/tool-executor.test.ts
```

### Integration Tests
```bash
# Test full agent workflow
npm test server/agent/agent-orchestrator.test.ts
```

### Manual Testing
Use the provided example UI or test via tRPC client:

```typescript
// Test query tool
const response = await trpc.agent.chat.mutate({
  projectId: 123,
  message: "Show me all high-severity red flags",
});

// Test generation tool
const response = await trpc.agent.chat.mutate({
  projectId: 123,
  message: "Generate a risk narrative for fact #789",
});

// Test workflow tool
const response = await trpc.agent.chat.mutate({
  projectId: 123,
  message: "What should I do next with this project?",
});
```

## Troubleshooting

### Agent not responding
- Check database connection
- Verify OpenAI API key is set
- Check server logs for errors

### Tools not executing
- Verify tool is registered in orchestrator
- Check tool parameter validation
- Ensure project database is accessible

### Learning not working
- Verify `agent_generated_content` table exists
- Check that content IDs match
- Ensure user has permission to submit edits

## Future Enhancements

- [ ] Support for custom tool plugins
- [ ] Multi-language support
- [ ] Voice interface integration
- [ ] Advanced analytics dashboard
- [ ] Fine-tuned models for domain-specific tasks
- [ ] Collaborative learning across team members
- [ ] Integration with external knowledge bases

## Contributing

When adding new features:

1. Follow existing code structure and patterns
2. Add comprehensive JSDoc comments
3. Include unit tests for new components
4. Update this README with new functionality
5. Add examples for new tools or features

## License

MIT License - see LICENSE file for details
