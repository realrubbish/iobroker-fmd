# Guidelines/JavaScript.md - ioBroker-fmd-adapter

## 1. TypeScript Guidelines

### 1.1 Language Choice

- **TypeScript** is the recommended language for this adapter
- Use strict type checking where possible
- Provide type definitions for `adapter.config`

### 1.2 TypeScript Configuration

```json
{
    "compilerOptions": {
        "noEmit": true,
        "allowJs": true,
        "checkJs": true,
        "resolveJsonModule": true,
        "outDir": "./build/",
        "sourceMap": true,
        "strict": false,
        "noImplicitAny": false,
        "useUnknownInCatchVariables": false,
        "extends": "@tsconfig/nodeXX/tsconfig.json"
    }
}
```

### 1.3 Adapter Config Types

```typescript
// src/types.d.ts
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            serverUrl: string;
            username: string;
            password: string;
            notifyOnError: boolean;
        }
    }
}

export {};
```

### 1.4 Type Annotations

```typescript
// Function parameters
async function sendRingCommand(deviceId: string): Promise<void> {
    // ...
}

// Return types
function parseResponse(data: unknown): FmdResponse {
    // ...
}

// State types
interface StateChange {
    id: string;
    state: ioBroker.State | null;
}
```

## 2. Code Style

### 2.1 General Rules

- Use **2 spaces** for indentation (or 4, be consistent)
- Use **single quotes** for strings
- Add **semicolons** at end of statements
- Maximum line length: **120 characters**
- Use **const** by default, **let** when reassignment needed
- Never use **var**

### 2.2 Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `serverUrl`, `isConnected` |
| Functions | camelCase | `sendRingCommand()` |
| Classes | PascalCase | `FmdAdapter` |
| Constants | UPPER_SNAKE | `MAX_RETRIES` |
| Types/Interfaces | PascalCase | `FmdAuth`, `RingOptions` |
| Private members | _prefix | `_authToken` |

### 2.3 File Structure

```typescript
// 1. Imports
import * as utils from "@iobroker/adapter-core";
import axios from "axios";

// 2. Type definitions
interface FmdAuth { ... }

// 3. Constants
const RETRY_DELAYS = [1000, 5000, 30000];

// 4. Main class
class FmdAdapter extends utils.Adapter {
    // ...
}

// 5. Export
export = FmdAdapter;
```

## 3. Adapter Patterns

### 3.1 Main Class

```typescript
import * as utils from "@iobroker/adapter-core";

class FmdAdapter extends utils.Adapter {
    private auth: FmdAuth | null = null;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: "iobroker-fmd" });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        // Initialize adapter
    }

    private onUnload(callback: () => void): void {
        // Cleanup
        callback();
    }

    private onStateChange(id: string, state: ioBroker.State | null): void {
        // Handle state changes
    }
}

export = FmdAdapter;
```

### 3.2 Lifecycle Methods

```typescript
// onReady - async initialization
private async onReady(): Promise<void> {
    await this.initConfig();
    await this.authenticate();
    this.subscribeStates("ring");
}

// onUnload - synchronous cleanup
private onUnload(callback: () => void): void {
    clearTimeout(this.retryTimer);
    this.httpClient = null;
    callback();
}

// onStateChange - handle subscriptions
private onStateChange(id: string, state: ioBroker.State | null): void {
    if (!state || state.ack) return;
    // Handle command
}
```

### 3.3 Error Handling

```typescript
// Try-catch with logging
try {
    await this.sendRingCommand(deviceId);
} catch (err) {
    this.adapter.log.error(`Ring failed: ${(err as Error).message}`);
    await this.updateErrorState((err as Error).message);
}

// Async error handling
private async authenticate(): Promise<void> {
    try {
        this.auth = await FmdClient.login(
            this.config.serverUrl,
            this.config.username,
            this.config.password
        );
    } catch (err) {
        this.adapter.log.error(`Auth failed: ${err}`);
        throw err;
    }
}
```

## 4. Async/Await Patterns

### 4.1 Promises

```typescript
// Prefer async/await over .then()
async function fetchData(): Promise<Data> {
    const response = await axios.get(url);
    return response.data;
}

// Handle errors
async function safeOperation(): Promise<Result | null> {
    try {
        return await riskyOperation();
    } catch {
        return null;
    }
}
```

### 4.2 Parallel Operations

```typescript
// Execute in parallel when possible
const [devices, status] = await Promise.all([
    this.getDevices(),
    this.checkServerStatus()
]);

// Sequential when order matters
for (const device of devices) {
    await this.pingDevice(device);
}
```

## 5. State Management

### 5.1 Reading States

```typescript
// With callback
this.getState("info.connection", (err, state) => {
    if (err) {
        this.adapter.log.error(err);
    } else {
        const connected = state?.val;
    }
});

// With async/await
const state = await this.getStateAsync("info.connection");
const connected = state?.val as boolean;
```

### 5.2 Writing States

```typescript
// Simple state
await this.setStateAsync("info.connection", {
    val: true,
    ack: true
});

// With options
await this.setStateAsync("ring", {
    val: deviceId,
    ack: false,  // Command, not acknowledged
    ts: Date.now()
});
```

### 5.3 Subscriptions

```typescript
// Subscribe to specific state
this.subscribeStates("ring");

// Subscribe with pattern
this.subscribeStates("info.*");

// Handle in onStateChange
private onStateChange(id: string, state: ioBroker.State | null): void {
    if (id.endsWith(".ring") && state && !state.ack) {
        this.handleRingCommand(state.val as string);
    }
}
```

## 6. HTTP/API Calls

### 6.1 Axios Configuration

```typescript
private createHttpClient(): axios.AxiosInstance {
    return axios.create({
        baseURL: this.config.serverUrl,
        timeout: 10000,
        headers: {
            "Content-Type": "application/json"
        }
    });
}
```

### 6.2 Request with Auth

```typescript
private async authenticatedRequest<T>(
    method: string,
    path: string,
    data?: unknown
): Promise<T> {
    const response = await this.httpClient.request<T>({
        method,
        url: path,
        data,
        headers: {
            IDT: this.auth!.accessToken
        }
    });
    return response.data;
}
```

## 7. Logging

### 7.1 Log Levels

```typescript
this.adapter.log.error("Critical error message");
this.adapter.log.warn("Warning: something might be wrong");
this.adapter.log.info("Operation completed successfully");
this.adapter.log.debug("Detailed debug information");
this.adapter.log.silly("Maximum verbosity");
```

### 7.2 Log Formatting

```typescript
// Include context
this.adapter.log.error(`FMD API error: ${err.message}`);
this.adapter.log.info(`Ring sent to device: ${deviceId}`);
this.adapter.log.debug(`Auth token expires: ${expiryDate.toISOString()}`);
```

## 8. Testing

### 8.1 Test Structure

```typescript
// test/unit/main.test.ts
import { expect } from "chai";
import { FmdAdapter } from "../src/main";

describe("FmdAdapter", () => {
    let adapter: FmdAdapter;

    beforeEach(() => {
        adapter = new FmdAdapter({ ... });
    });

    describe("authenticate()", () => {
        it("should authenticate with valid credentials", async () => {
            const auth = await adapter.authenticate();
            expect(auth.accessToken).to.be.a("string");
        });

        it("should throw on invalid credentials", async () => {
            await expect(
                adapter.authenticate("invalid", "wrong")
            ).to.be.rejectedWith("Authentication failed");
        });
    });
});
```

### 8.2 Mocking

```typescript
import { MockAdapter } from "@iobroker/testing";

const mockAdapter = new MockAdapter();

// Mock states
mockAdapter.setState("info.connection", { val: true, ack: true });

// Mock objects
mockAdapter.setObject("info.connection", {
    type: "state",
    common: { role: "indicator.reachable" }
});
```

## 9. Security

### 9.1 Credential Handling

```typescript
// Credentials are stored encrypted by ioBroker
// Access via adapter.config (decrypted automatically)
const password = this.config.password;

// Never log passwords
this.adapter.log.debug(`Connecting as: ${this.config.username}`);
// NOT: this.adapter.log.debug(`Password: ${this.config.password}`);
```

### 9.2 Input Validation

```typescript
function validateConfig(config: ioBroker.AdapterConfig): void {
    if (!config.serverUrl) {
        throw new Error("serverUrl is required");
    }

    if (!config.username || !config.password) {
        throw new Error("Username and password are required");
    }

    try {
        new URL(config.serverUrl);
    } catch {
        throw new Error("Invalid serverUrl format");
    }
}
```

## 10. ESLint Configuration

### 10.1 Configuration File

```javascript
// .eslintrc.cjs (or eslint.config.mjs)
const { iobroker } = require("@iobroker/eslint-config");

module.exports = {
    ...iobroker,
    rules: {
        ...iobroker.rules,
        // Custom rules
        "no-console": "warn"
    }
};
```

### 10.2 Ignoring Files

```javascript
{
    ignores: [
        "build/",
        "dist/",
        "*.test.js",
        "test/**/*.js",
        "admin/words.js"
    ]
}
```

## 11. References

- [ioBroker create-adapter](https://github.com/ioBroker/create-adapter)
- [@iobroker/testing](https://github.com/ioBroker/testing)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [ESLint](https://eslint.org/)
