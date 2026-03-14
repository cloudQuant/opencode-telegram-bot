# AGENTS.md

Instructions for AI agents working on this project.

## Project Overview

**opencode-telegram-bot** is a Telegram bot that acts as a mobile client for OpenCode.
Functional requirements and development status are in [PRODUCT.md](./PRODUCT.md).

## Technology Stack

- **Language:** TypeScript 5.x (strict mode, ES2022 target)
- **Runtime:** Node.js 20+ | **Module:** ESM (`"type": "module"`)
- **Package manager:** npm | **Test:** Vitest | **Lint:** ESLint + Prettier

### Core Dependencies

`grammy` (Telegram Bot), `@grammyjs/menu`, `@opencode-ai/sdk`, `dotenv`

## Build / Lint / Test Commands

```bash
npm run build          # Compile TypeScript (tsc)
npm run lint           # ESLint check (--max-warnings=0)
npm run format         # Prettier --write
npm test               # Run all tests (vitest run)
npm run test:coverage  # Tests with coverage

# Run a single test file
npx vitest run tests/session/cache-manager.test.ts

# Run tests matching a pattern
npx vitest run -t "warms up cache"

# Watch mode for development
npx vitest watch tests/session/
```

## Code Style Guidelines

### Formatting (Prettier)

```json
{ "semi": true, "trailingComma": "all", "singleQuote": false, "printWidth": 100, "tabWidth": 2 }
```

### Imports

- **Always use `.js` extensions** in import paths for ESM compatibility:
  ```typescript
  import { logger } from "../utils/logger.js"; // Correct
  import { logger } from "../utils/logger"; // Wrong
  ```
- Node.js built-ins use `node:` prefix: `import path from "node:path";`
- Group imports: external packages first, then internal modules

### TypeScript

- Strict mode enabled - no `any` without justification (ESLint warns)
- Prefer explicit return types for exported functions
- Use `type` for type aliases, `interface` for object shapes
- Unused parameters prefixed with `_` to satisfy linter

### Naming Conventions

| Type                | Convention           | Examples                                 |
| ------------------- | -------------------- | ---------------------------------------- |
| Files               | kebab-case           | `session-manager.ts`, `cache-manager.ts` |
| Functions/variables | camelCase            | `getCurrentSession`, `sessionListMock`   |
| Types/interfaces    | PascalCase           | `SessionInfo`, `BotCommandDefinition`    |
| Constants           | SCREAMING_SNAKE_CASE | `LOG_LEVELS`                             |

### Error Handling

```typescript
try {
  const result = await client.session.list();
  if (result.error) {
    logger.error("[SessionManager] Failed to list sessions", result.error);
    return null;
  }
  return result.data;
} catch (error) {
  logger.error("[SessionManager] Unexpected error", error);
  throw error;
}
```

- Log errors with context (component name, operation type)
- Never expose stack traces to users; use i18n for user messages

### Logging

Use `src/utils/logger.ts` - never raw `console.log`:

```typescript
import { logger } from "../utils/logger.js";

logger.debug("[Component] Detailed diagnostics", { detail });
logger.info("[Component] Important lifecycle event");
logger.warn("[Component] Recoverable issue", error);
logger.error("[Component] Critical failure", error);
```

Levels: `debug` (diagnostics) < `info` (events) < `warn` (recoverable) < `error` (critical)

## Architecture

### Main Components

1. **Bot Layer** - grammY setup, middleware, commands (`src/bot/`)
2. **OpenCode Client** - SDK wrapper, SSE events (`src/opencode/`)
3. **State Managers** - session/project/model/agent/variant (`src/*/manager.ts`)
4. **Summary Pipeline** - event aggregation, formatting (`src/summary/`)
5. **Process Manager** - OpenCode server control (`src/process/`)
6. **Runtime/CLI** - mode detection, bootstrap (`src/runtime/`, `src/cli/`)
7. **I18n** - localization (`src/i18n/`)

### State Management

- Persistent: `settings.json` (via `src/settings/manager.ts`)
- Runtime: in-memory managers (singletons)
- Multi-instance support via `OPENCODE_TELEGRAM_HOME` environment variable

### Multiple Bot Instances

The bot supports running multiple independent instances, each with its own:

- Telegram bot token (different bots)
- Project selection
- Session management
- Settings persistence

Each instance uses a separate configuration directory:

```
config/
├── bot_work/
│   ├── .env           # Bot token, user ID, model config
│   ├── settings.json  # Project, session, agent state
│   ├── bot.pid        # Running process ID
│   └── bot.log        # Log output
└── bot_personal/
    └── ...
```

Set `OPENCODE_TELEGRAM_HOME` to the config directory path before starting.

### Management Scripts

```cmd
create_bot.bat <name>   # Create new bot config directory
start_bot.bat <name>    # Start a bot instance
stop_bot.bat <name>     # Stop a bot instance
list_bots.bat           # List all bots and their status
restart_bot.bat <name>  # Restart a bot instance
```

### Bot Commands

Centralized in `src/bot/commands/definitions.ts`. Add new commands to `COMMAND_DEFINITIONS` array only.

## Testing

- Tests in `tests/` (mirrors `src/` structure)
- Setup: `tests/setup.ts` (resets singletons, restores mocks)
- Use `vi.mock()` for external dependencies

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("module", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does something", () => {
    /* Arrange, Act, Assert */
  });
});
```

## AI Agent Rules

- Reply in the same language as the user's question
- Use `question` tool for plan confirmations
- Never make major decisions (architecture, mass deletion) without explicit confirmation
- Never commit automatically - only when explicitly asked
- Runtime is Windows - avoid fragile PowerShell one-liners; use absolute paths with file tools

### Workflow

1. Read [PRODUCT.md](./PRODUCT.md) for scope/status
2. Inspect existing code before changes
3. Add/update tests for new functionality
4. Run: `npm run build && npm run lint && npm test`
5. Update PRODUCT.md checkboxes when tasks complete
