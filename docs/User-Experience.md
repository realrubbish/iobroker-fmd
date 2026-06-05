# User-Experience.md - ioBroker-fmd-adapter

## 1. User Experience Overview

This document describes user experience patterns and error handling for the ioBroker-fmd-adapter.

## 2. Error Handling Philosophy

### 2.1 Principle

The adapter should fail gracefully with clear, actionable error messages. Users should know:
- What went wrong
- Why it went wrong
- How to fix it (if possible)

### 2.2 Error Communication Layers

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Log | `adapter.log.error()` | Developer/Debugging |
| State | `indicator.error` state | UI integration |
| Notification | `registerNotification()` | System-wide alert |
| Quality Code | `state.q` | Machine-readable status |

## 3. Logging Strategy

### 3.1 Log Levels

| Level | When to Use | Visibility |
|-------|-------------|------------|
| `error` | Failures, exceptions | Always visible |
| `warn` | Recoverable issues, retries | Admin logs |
| `info` | Successful operations | Admin logs |
| `debug` | Detailed flow tracing | Debug mode only |
| `silly` | Maximum verbosity | Debug mode only |

### 3.2 Log Messages

```typescript
// Connection failure
adapter.log.error(`FMD connection failed: ${err.message}`);

// Retry attempt
adapter.log.warn(`FMD response timeout, retrying in ${retryDelay}ms...`);

// Success
adapter.log.info(`Ring command sent successfully to device: ${deviceId}`);

// Debug info
adapter.log.debug(`Auth token expires in: ${expiresIn}s`);
```

### 3.3 Log Formatting

- Include context: error codes, device IDs, URLs
- Be specific: "Connection refused to https://fmd.example.com" not "Connection failed"
- Use present tense: "failed" not "has failed"

## 4. State-Based Feedback

### 4.1 Indicator States

| State ID | Type | Role | Purpose |
|----------|------|------|---------|
| `fmd.0.info.connection` | boolean | `indicator.reachable` | Server connectivity |
| `fmd.0.info.error` | boolean | `indicator.error` | Error state |
| `fmd.0.info.lastError` | string | `text` | Error message |
| `0_userdata.0.FindMyDevice.ring` | string | `command` | Ring trigger |

### 4.2 Quality Codes

```typescript
// Setting state with quality
adapter.setState('fmd.0.info.connection', {
    val: true,
    ack: true,
    q: 0  // Good
});

adapter.setState('fmd.0.info.error', {
    val: true,
    ack: true,
    q: 0x02  // No connection
});
```

| Code | Hex | Name | Meaning |
|------|-----|------|---------|
| 0 | 0x00 | Good | No error |
| 1 | 0x01 | General Problem | Generic issue |
| 2 | 0x02 | No Connection | Cannot reach server |
| 4 | 0x04 | Device Error | FMD device error |
| 8 | 0x08 | Sensor Error | Data validation |

### 4.3 State Updates

```typescript
// Update connection state
async function updateConnectionState(connected: boolean): Promise<void> {
    await this.setStateAsync('info.connection', {
        val: connected,
        ack: true,
        q: connected ? 0 : 0x02
    });
}

// Update error state
async function updateErrorState(error: string | null): Promise<void> {
    await this.setStateAsync('info.error', {
        val: error !== null,
        ack: true,
        q: error ? 0x02 : 0
    });

    await this.setStateAsync('info.lastError', {
        val: error || '',
        ack: true
    });
}
```

## 5. Notifications

### 5.1 When to Notify

Send notifications for:
- Connection failures
- Authentication failures
- Ring command failures
- Successful ring (optional, configurable)

### 5.2 Notification Format

```typescript
// Error notification
adapter.registerNotification(
    'FMD',                          // Scope
    'connectionError',               // Category
    `Cannot connect to FMD server: ${err.message}` // Message
);

// Auth failure
adapter.registerNotification(
    'FMD',
    'authFailed',
    'FMD authentication failed. Please check credentials.'
);
```

### 5.3 Notification Categories

| Category | Trigger | Severity |
|----------|---------|----------|
| `connectionError` | Cannot reach FMD server | Error |
| `authFailed` | Invalid credentials | Error |
| `ringFailed` | Ring command failed | Error |
| `ringSent` | Ring command succeeded | Info |
| `serverReachable` | Server connection restored | Info |

## 6. User Feedback in Admin UI

### 6.1 Configuration Validation

```typescript
// Validate server URL
function validateServerUrl(url: string): string | null {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return 'Server URL must use HTTP or HTTPS';
        }
        return null; // Valid
    } catch {
        return 'Invalid server URL format';
    }
}
```

### 6.2 Input Validation in jsonConfig

```json
{
    "serverUrl": {
        "type": "text",
        "label": "FMD Server URL",
        "validator": "^(https?://).+",
        "help": "Must start with http:// or https://"
    },
    "username": {
        "type": "text",
        "label": "Username",
        "validator": ".+",
        "help": "Your FMD account username"
    }
}
```

### 6.3 Help Text

Always provide help text for:
- Required fields
- Non-obvious configuration
- Credential storage explanation
- URL format requirements

## 7. Error Recovery

### 7.1 Automatic Retry

```typescript
const RETRY_DELAYS = [1000, 5000, 30000, 60000]; // ms

async function sendWithRetry(fn: () => Promise<void>): Promise<void> {
    let lastError: Error;

    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
        try {
            await fn();
            return; // Success
        } catch (err) {
            lastError = err;
            adapter.log.warn(`Attempt ${attempt + 1} failed: ${err.message}`);
            if (attempt < RETRY_DELAYS.length - 1) {
                await sleep(RETRY_DELAYS[attempt]);
            }
        }
    }

    throw lastError; // All retries exhausted
}
```

### 7.2 Token Refresh

```typescript
async function ensureAuthenticated(): Promise<void> {
    if (this.isTokenExpired()) {
        adapter.log.info('Auth token expired, re-authenticating...');
        await this.authenticate();
    }
}
```

## 8. Empty States

### 8.1 No Devices

When no FMD devices are found:
```
No devices found on FMD server.
Please ensure:
1. Your FMD server is running
2. You have added devices to your FMD account
3. Your credentials are correct
```

### 8.2 Not Configured

When adapter is not yet configured:
```
Adapter not configured.
Please set:
1. FMD Server URL
2. Username
3. Password
in the adapter settings.
```

## 9. User Education

### 9.1 First-Time Setup

Guide users through:
1. Finding FMD server URL
2. Creating FMD account
3. Adding devices to FMD
4. Configuring adapter
5. Testing the connection

### 9.2 vis-2 Integration

Provide example configurations:
```json
{
  "oid": "0_userdata.0.FindMyDevice.ring",
  "value": "my-phone",
  "label": "Find Phone"
}
```

### 9.3 Hardware Button Setup

Document the button trigger path:
```
Button → MQTT → shelly adapter → ioBroker State →
JavaScript (on trigger) → FMD Adapter → FMD Server → Phone
```

## 10. Accessibility

### 10.1 Color Contrast

- Ensure WCAG 2.1 AA compliance
- Don't rely on color alone for status
- Use icons + text for states

### 10.2 Screen Reader Support

- Use semantic HTML in Admin UI
- Provide aria-labels for icons
- Announce error states

## 11. References

- [ioBroker Logging](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/logging.md)
- [ioBroker State Roles](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md)
- [ioBroker Notifications](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/notifications.md)
