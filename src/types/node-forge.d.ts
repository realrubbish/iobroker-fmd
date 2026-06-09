// Minimal ambient module declaration for the subset of `node-forge`
// we use in `FmdApi.signRequest` and the `scripts/ring-smoke.mjs`
// `--verify` self-test. `node-forge@1.4.0` ships no bundled .d.ts
// files, and the DefinitelyTyped package `@types/node-forge` is a
// legacy 0.10.x shim whose shape does not match the current 1.x
// API. A local shim is the smallest delta and the most explicit
// about the API surface we depend on.
//
// Pinned API surface (see design D1 / D3 in
// openspec/changes/fix-ring-signing-followup/design.md):
//   - pki.rsa.generateKeyPair, pki.privateKeyFromAsn1,
//     pki.privateKeyToAsn1, pki.wrapRsaPrivateKey
//   - asn1.fromDer, asn1.toDer
//   - pss.create (positional: md, mgf, saltLength)
//   - mgf.mgf1.create (returns object with .generate)
//   - md.sha256.create (returns MessageDigest)
//   - util.encode64, util.decode64, util.createBuffer
//
// If a future change needs more of the API, add the relevant
// declarations here rather than reaching for `@types/node-forge`.

declare module "node-forge" {
    // -----------------------------------------------------------------
    // forge.md — message digests
    // -----------------------------------------------------------------
    export namespace md {
        interface MessageDigest {
            algorithm: string;
            digestLength: number;
            update(msg: string | ByteStringBuffer, encoding?: string): MessageDigest;
            digest(): ByteStringBuffer;
        }
        namespace sha256 {
            function create(): MessageDigest;
        }
        namespace sha512 {
            function create(): MessageDigest;
        }
    }

    // -----------------------------------------------------------------
    // forge.mgf — mask generation functions
    // -----------------------------------------------------------------
    export namespace mgf {
        namespace mgf1 {
            interface MGF {
                generate(seed: string, maskLen: number): string;
            }
            function create(md: md.MessageDigest): MGF;
        }
    }

    // -----------------------------------------------------------------
    // forge.pss — RSA-PSS signature scheme
    // -----------------------------------------------------------------
    export namespace pss {
        interface PSSScheme {
            encode(md: md.MessageDigest, modBits: number): string;
            verify(digest: string, encrypted: string, modBits: number): boolean;
        }
        function create(md: md.MessageDigest, mgf: mgf.mgf1.MGF, saltLength: number): PSSScheme;
    }

    // -----------------------------------------------------------------
    // forge.asn1 — ASN.1 parse / serialise
    // -----------------------------------------------------------------
    export namespace asn1 {
        interface Asn1 {
            tagClass: number;
            type: number;
            constructed: boolean;
            value: string | Asn1[];
        }
        function fromDer(buf: ByteStringBuffer, strict?: boolean): Asn1;
        function toDer(obj: Asn1): { getBytes(): string };
    }

    // -----------------------------------------------------------------
    // forge.util — bytes / base64 / buffers
    // -----------------------------------------------------------------
    export namespace util {
        interface ByteStringBuffer {
            length(): number;
            getBytes(): string;
            putInt32(n: number): ByteStringBuffer;
            putBuffer(buf: ByteStringBuffer): ByteStringBuffer;
            truncate(length: number): ByteStringBuffer;
            toHex(): string;
        }
        function createBuffer(input: string | ArrayBuffer | Uint8Array, encoding?: string): ByteStringBuffer;
        function encode64(input: string | ByteStringBuffer): string;
        function decode64(input: string): string;
    }

    // -----------------------------------------------------------------
    // forge.pki — keys, RSA
    // -----------------------------------------------------------------
    export namespace pki {
        interface RSAPrivateKey {
            n: { bitLength(): number };
            sign(md: md.MessageDigest, scheme: pss.PSSScheme | string | null): string;
        }
        interface RSAPublicKey {
            n: { bitLength(): number };
            verify(digest: string, signature: string, scheme: pss.PSSScheme | string | null): boolean;
        }
        interface RsaKeyPair {
            privateKey: RSAPrivateKey;
            publicKey: RSAPublicKey;
        }
        namespace rsa {
            function generateKeyPair(opts: { bits: number; e?: number }, callback?: (err: Error | null, keys: RsaKeyPair) => void): RsaKeyPair | Promise<RsaKeyPair>;
        }
        function privateKeyFromAsn1(asn1: asn1.Asn1): RSAPrivateKey;
        function privateKeyToAsn1(key: RSAPrivateKey): asn1.Asn1;
        function wrapRsaPrivateKey(rsaKey: asn1.Asn1): asn1.Asn1;
    }

    // The default import shape we use in the adapter.
    const forge: {
        pki: typeof pki;
        asn1: typeof asn1;
        pss: typeof pss;
        mgf: typeof mgf;
        md: typeof md;
        util: typeof util;
    };
    export default forge;
}
