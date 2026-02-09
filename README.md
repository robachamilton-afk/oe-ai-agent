# @oe-ecosystem/ai-agent

**AI Agent module for the OE Ecosystem**

This package provides a production-ready, embeddable AI assistant that can be deployed across multiple applications. It offers a conversational interface for natural language interaction with project data, content generation, and workflow assistance.

[![npm version](https://img.shields.io/npm/v/@oe-ecosystem/ai-agent.svg)](https://www.npmjs.com/package/@oe-ecosystem/ai-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## ✨ Features

- **Conversational Interface:** Natural language interaction with project data
- **Tool Execution:** Perform actions like database queries and content generation
- **Learning & Adaptation:** Analyzes user edits to improve future generations
- **Content Generation:** Create technical reports, risk narratives, and specifications
- **Workflow Assistance:** Guide users through predefined processes
- **Type-Safe:** Fully written in TypeScript with comprehensive type definitions
- **Flexible Integration:** Can be integrated into any tRPC-based application

---

## 📦 Installation

```bash
npm install @oe-ecosystem/ai-agent
```

Or with yarn:

```bash
yarn add @oe-ecosystem/ai-agent
```

---

## ⚙️ Peer Dependencies

This package has the following peer dependencies that must be installed in your project:

- `drizzle-orm`: `^0.30.0`
- `mysql2`: `^3.0.0`
- `@trpc/server`: `^10.0.0`

---

## 🚀 Quick Start

### 1. Set up Dependencies

First, create a factory function to provide the required tRPC and database dependencies.

**`src/lib/agent-dependencies.ts`**
```typescript
import { router, protectedProcedure } from "../server/trpc";
import { getDb } from "../server/db";
import { createProjectDbConnection } from "../server/db-connection";
import type { AgentRouterDependencies } from "@oe-ecosystem/ai-agent";

export const agentDependencies: AgentRouterDependencies = {
  router,
  protectedProcedure,
  getDb,
  createProjectDbConnection,
};
```

### 2. Create the Agent Router

Use the `createAgentRouter` factory to create the tRPC router.

**`src/server/routers/agent.ts`**
```typescript
import { createAgentRouter } from "@oe-ecosystem/ai-agent";
import { agentDependencies } from "../../lib/agent-dependencies";

export const agentRouter = createAgentRouter(agentDependencies);
```

### 3. Add to Main App Router

Merge the agent router into your main tRPC app router.

**`src/server/routers/_app.ts`**
```typescript
import { router } from "../trpc";
import { agentRouter } from "./agent";

export const appRouter = router({
  agent: agentRouter,
  // ... your other routers
});

export type AppRouter = typeof appRouter;
```

### 4. Use in Your Application

You can now call the agent procedures from your client-side code.

```typescript
import { trpc } from "../utils/trpc";

function AgentChat() {
  const chatMutation = trpc.agent.chat.useMutation();

  const sendMessage = () => {
    chatMutation.mutate({
      projectId: 123,
      message: "What are the high-severity red flags?",
    });
  };

  // ... render chat interface
}
```

---

## 🛠️ Core Components

### `AgentOrchestrator`

The main coordinator that brings together all agent components.

```typescript
import { AgentOrchestrator } from "@oe-ecosystem/ai-agent";

const orchestrator = new AgentOrchestrator(db, createProjectDbConnection);

const response = await orchestrator.processRequest({
  userId: 1,
  projectId: 123,
  message: "Hello, agent!",
});
```

### `ConversationManager`

Manages multi-turn conversation state and message history.

```typescript
import { ConversationManager } from "@oe-ecosystem/ai-agent";

const conversationManager = new ConversationManager(db);

const history = await conversationManager.getConversationHistory("conv-123");
```

### `ToolExecutor`

Executes agent actions (database queries, content generation, etc.).

```typescript
import { ToolExecutor, queryTools } from "@oe-ecosystem/ai-agent";

const toolExecutor = new ToolExecutor(db);
toolExecutor.registerTools(queryTools);

const result = await toolExecutor.executeTool("get_fact_details", { factId: 456 }, context);
```

### `LearningEngine`

Analyzes user edits to improve future generations.

```typescript
import { LearningEngine } from "@oe-ecosystem/ai-agent";

const learningEngine = new LearningEngine(db);

await learningEngine.learnFromEdit(
  "content-789",
  "This is the user\'s corrected version."
);
```

---

## 🗃️ Database Schema

This package includes Drizzle ORM schema definitions for all agent-related tables. You will need to add these to your main database schema and run migrations.

**Exported Schemas:**
- `agentConversations`
- `agentMessages`
- `agentActions`
- `agentLearningSamples`
- `agentStyleModels`
- `agentKnowledgeBase`
- `agentGeneratedContent`

**Example Migration:**
```sql
CREATE TABLE `agent_conversations` (
  `id` varchar(255) NOT NULL,
  `user_id` int NOT NULL,
  `project_id` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `context` json,
  `status` enum(\'active\',\'archived\',\'deleted\') NOT NULL DEFAULT \'active\',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(`id`)
);
-- ... other tables
```

---

## 🔧 Customization

### Adding Custom Tools

You can create your own tool definitions and register them with the `ToolExecutor`.

```typescript
import type { ToolDefinition } from "@oe-ecosystem/ai-agent";

const customTool: ToolDefinition = {
  name: "send_email",
  description: "Sends an email to a specified recipient",
  parameters: {
    type: "object",
    properties: {
      recipient: { type: "string", description: "Email address of the recipient" },
      subject: { type: "string", description: "Subject of the email" },
      body: { type: "string", description: "Body of the email" },
    },
    required: ["recipient", "subject", "body"],
  },
  handler: async (args, context) => {
    // Your email sending logic here
    console.log(`Sending email to ${args.recipient}`);
    return { success: true };
  },
};

toolExecutor.registerTool(customTool);
```

### Overriding System Prompts

The `AgentOrchestrator` allows you to override the default system prompt.

```typescript
const orchestrator = new AgentOrchestrator(db, createProjectDbConnection);

orchestrator.buildSystemPrompt = (request) => {
  return `You are a helpful assistant for project ${request.projectId}. Your role is to be a pirate.`;
};
```

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
