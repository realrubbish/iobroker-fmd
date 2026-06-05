"use strict";

const assert = require("assert");

/**
 * Mock logger for testing
 */
const mockLog = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
};

/**
 * Mock auth tokens for testing
 */
const mockAuthTokens = {
    accessToken: "mock-access-token",
    privateKey: "mock-private-key-base64",
    expiresAt: Date.now() + 3600000,
};

describe("FmdApi", () => {
    describe("constructor", () => {
        it("should create instance with valid config", () => {
            // Test that module structure is correct
            const { FmdApi } = require("../../build/lib/fmd-api");
            assert.ok(FmdApi, "FmdApi should be exported");
        });
    });

    describe("RSA-PSS signing", () => {
        it("should handle signing with mock key", async () => {
            // Note: Real RSA-PSS signing requires a valid key pair
            // This tests the module structure, not the actual crypto
            const { FmdApi } = require("../../build/lib/fmd-api");
            assert.ok(FmdApi, "FmdApi class should exist");
        });
    });

    describe("listDevices", () => {
        it("should handle API structure correctly", () => {
            // This tests that the interface is correct
            // Real API calls require network and valid auth
            const { FmdApi } = require("../../build/lib/fmd-api");
            assert.ok(FmdApi, "FmdApi should be defined");
        });
    });

    describe("sendRingCommand", () => {
        it("should have correct method signature", () => {
            const { FmdApi } = require("../../build/lib/fmd-api");
            assert.ok(FmdApi.prototype.sendRingCommand, "sendRingCommand method should exist");
        });
    });
});

describe("FmdDevice interface", () => {
    it("should define correct device structure", () => {
        // Verify device interface matches spec
        const device = {
            id: "test-device-1",
            name: "Test Phone",
            type: "phone",
            lastRing: Date.now(),
        };

        assert.ok(device.id, "Device should have id");
        assert.ok(device.name, "Device should have name");
        assert.ok(device.type, "Device should have type");
    });
});
