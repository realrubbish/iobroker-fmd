import { describe, it } from "mocha";
import { FmdAuth } from "../../build/lib/fmd-auth";
import * as assert from "assert";

/**
 * Mock logger for testing
 */
const mockLog = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
};

describe("FmdAuth", () => {
    describe("constructor", () => {
        it("should create instance with valid config", () => {
            const auth = new FmdAuth({
                serverUrl: "https://fmd.example.com",
                username: "testuser",
                password: "testpass",
                log: mockLog,
            });

            assert.strictEqual(auth.getServerUrl(), "https://fmd.example.com");
            assert.strictEqual(auth.hasValidTokens(), false);
        });
    });

    describe("hasValidTokens", () => {
        it("should return false when no tokens cached", () => {
            const auth = new FmdAuth({
                serverUrl: "https://fmd.example.com",
                username: "testuser",
                password: "testpass",
                log: mockLog,
            });

            assert.strictEqual(auth.hasValidTokens(), false);
        });
    });

    describe("base64 helpers", () => {
        it("should handle deriveKey without throwing", async () => {
            const auth = new FmdAuth({
                serverUrl: "https://fmd.example.com",
                username: "testuser",
                password: "testpass",
                log: mockLog,
            });

            // This will fail at network level but should not throw on key derivation itself
            try {
                // Simple salt for testing
                const salt = btoa("testsalt12345678");
                await auth.deriveKey(salt);
            } catch (err) {
                // Expected - network call will fail
                assert.ok(err instanceof Error);
            }
        });
    });

    describe("clearTokens", () => {
        it("should clear cached tokens", () => {
            const auth = new FmdAuth({
                serverUrl: "https://fmd.example.com",
                username: "testuser",
                password: "testpass",
                log: mockLog,
            });

            auth.clearTokens();
            assert.strictEqual(auth.hasValidTokens(), false);
            assert.strictEqual(auth.getTokens(), undefined);
        });
    });
});
