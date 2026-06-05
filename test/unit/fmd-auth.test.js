"use strict";

const assert = require("assert");
const { FmdAuth } = require("../../build/lib/fmd-auth");

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
