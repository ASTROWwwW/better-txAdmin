import { suite, it, expect } from 'vitest';
import { parseStreamMessage } from './parseMessage';

const URL_OK = 'http://1.2.3.4:30120/monitor/stream/tok_abcdefghijklmnop-1234';
const start = (data: any = {}) => ({ action: 'screenStreamStart', data: { url: URL_OK, fps: 12, width: 640, quality: 0.5, ttlMs: 600000, ...data } });
const self = {} as any; //stands for the window of the page

suite('parseStreamMessage', () => {
    it('accepts a start from the game (no source, or the page itself)', () => {
        expect(parseStreamMessage(start(), null, self)).toEqual({ type: 'start', cfg: start().data });
        expect(parseStreamMessage(start(), undefined, self)?.type).toBe('start');
        expect(parseStreamMessage(start(), self, self)?.type).toBe('start');
    });

    it('accepts a stop', () => {
        expect(parseStreamMessage({ action: 'screenStreamStop', data: {} }, null, self)).toEqual({ type: 'stop' });
    });

    it('ignores a message that comes from another window, like the iframe of the web panel', () => {
        expect(parseStreamMessage(start(), {} as any, self)).toBeNull();
        expect(parseStreamMessage({ action: 'screenStreamStop', data: {} }, {} as any, self)).toBeNull();
    });

    it.each([
        ['an other url scheme', 'https://1.2.3.4:30120/monitor/stream/tok_abcdefghijklmnop-1234'],
        ['a url that is not the stream path', 'http://1.2.3.4:30120/monitor/other/tok_abcdefghijklmnop-1234'],
        ['a token that is too short', 'http://1.2.3.4:30120/monitor/stream/abc'],
        ['a user in the url (evil.example would be the host)', 'http://1.2.3.4@evil.example/monitor/stream/tok_abcdefghijklmnop-1234'],
        ['a query string', 'http://1.2.3.4:30120/monitor/stream/tok_abcdefghijklmnop-1234?x=1'],
        ['a path with more parts', 'http://1.2.3.4:30120/a/b/stream/tok_abcdefghijklmnop-1234'],
        ['a space', 'http://1.2.3.4:30120/monitor/stream/tok_abcdefghijklmnop-1234 '],
        ['a backslash', 'http://1.2.3.4\\@evil.example/monitor/stream/tok_abcdefghijklmnop-1234'],
        ['an empty url', ''],
    ])('ignores %s', (_label, url) => {
        expect(parseStreamMessage(start({ url }), null, self)).toBeNull();
    });

    it('accepts a host name and a bracketed ipv6 endpoint', () => {
        expect(parseStreamMessage(start({ url: 'http://abcdef-xyz.users.cfx.re/monitor/stream/tok_abcdefghijklmnop-1234' }), null, self)?.type).toBe('start');
        expect(parseStreamMessage(start({ url: 'http://[::1]:30120/monitor/stream/tok_abcdefghijklmnop-1234' }), null, self)?.type).toBe('start');
    });

    it.each([
        ['text for fps', { fps: '12' }],
        ['null for width', { width: null }],
        ['an object for quality', { quality: {} }],
        ['a missing ttl', { ttlMs: undefined }],
    ])('ignores %s', (_label, patch) => {
        expect(parseStreamMessage(start(patch), null, self)).toBeNull();
    });

    it.each([null, undefined, 5, 'screenStreamStart', [], {}, { action: 5 }, { action: 'other', data: {} }, { action: 'screenStreamStart' }, { action: 'screenStreamStart', data: null }])('ignores %j', (value) => {
        expect(parseStreamMessage(value as any, null, self)).toBeNull();
    });
});
