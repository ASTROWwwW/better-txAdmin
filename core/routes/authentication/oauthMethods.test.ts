import { describe, expect, it } from 'vitest';
import { isAllowedOauthOrigin } from './oauthMethods';

describe('OAuth origin validation', () => {
    it('allows the same host over HTTPS, including forwarded HTTPS', () => {
        expect(isAllowedOauthOrigin('https://tx.example.test', 'tx.example.test')).toBe(true);
        expect(isAllowedOauthOrigin('https://tx.example.test:8443', 'tx.example.test:8443')).toBe(true);
        expect(isAllowedOauthOrigin('http://localhost:40120', 'localhost:40120')).toBe(true);
    });

    it('rejects arbitrary hosts and ports', () => {
        expect(isAllowedOauthOrigin('https://evil.example', 'tx.example.test')).toBe(false);
        expect(isAllowedOauthOrigin('https://tx.example.test:444', 'tx.example.test')).toBe(false);
        expect(isAllowedOauthOrigin('https://tx.example.test.evil.example', 'tx.example.test')).toBe(false);
    });

    it('rejects non-origin URLs and non-HTTP schemes', () => {
        expect(isAllowedOauthOrigin('javascript:alert(1)', 'tx.example.test')).toBe(false);
        expect(isAllowedOauthOrigin('https://tx.example.test/path', 'tx.example.test')).toBe(false);
        expect(isAllowedOauthOrigin('https://tx.example.test?foo=bar', 'tx.example.test')).toBe(false);
        expect(isAllowedOauthOrigin('https://user:pass@tx.example.test', 'tx.example.test')).toBe(false);
        expect(isAllowedOauthOrigin('//tx.example.test', 'tx.example.test')).toBe(false);
    });
});
