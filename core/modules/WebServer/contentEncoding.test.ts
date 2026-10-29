import { suite, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { acceptIdentityOnly, rejectEncodedBody } from './contentEncoding';

suite('acceptIdentityOnly', () => {
    it('accepts a request without Content-Encoding', () => {
        const headers: Record<string, unknown> = { 'content-type': 'application/json' };
        expect(acceptIdentityOnly(headers)).toBe(true);
        expect('content-encoding' in headers).toBe(false);
    });

    it('accepts identity in any casing or spacing and rewrites it so the parsers recognise it', () => {
        for (const value of ['identity', 'Identity', ' IDENTITY ', '\tidentity']) {
            const headers: Record<string, unknown> = { 'content-encoding': value };
            expect(acceptIdentityOnly(headers), JSON.stringify(value)).toBe(true);
            expect(headers['content-encoding']).toBe('identity');
        }
    });

    it('refuses every encoded body, whatever the casing', () => {
        for (const value of ['gzip', 'GZIP', 'br', 'deflate', 'zstd', 'compress', 'x-gzip']) {
            const headers: Record<string, unknown> = { 'content-encoding': value };
            expect(acceptIdentityOnly(headers), value).toBe(false);
            expect(headers['content-encoding']).toBe(value);
        }
    });

    it('refuses chains, merged duplicates, empty and non string values', () => {
        for (const value of ['identity, gzip', 'gzip, identity', 'identity, identity', '', ' ', ['gzip'], ['identity'], 5, null]) {
            expect(acceptIdentityOnly({ 'content-encoding': value }), JSON.stringify(value)).toBe(false);
        }
    });
});


suite('rejectEncodedBody over a real http server', () => {
    const request = (server: http.Server, headers: Record<string, string>) => new Promise<{ status: number; body: string; acceptEncoding?: string }>((resolve, reject) => {
        const { port } = server.address() as AddressInfo;
        const req = http.request({ port, method: 'POST', headers }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode!, body, acceptEncoding: res.headers['accept-encoding'] as string }));
        });
        req.on('error', reject);
        req.end('{}');
    });

    const withServer = async (fn: (server: http.Server, reached: string[]) => Promise<void>) => {
        const reached: string[] = [];
        const server = http.createServer((req, res) => {
            if (rejectEncodedBody(req, res)) return;
            reached.push(String(req.headers['content-encoding']));
            res.end('handled');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            await fn(server, reached);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    };

    it('answers 415 with an Accept-Encoding hint and never reaches the handler for a gzip body', () => withServer(async (server, reached) => {
        const res = await request(server, { 'content-encoding': 'GZip' });
        expect(res).toEqual({ status: 415, body: 'Unsupported Content-Encoding', acceptEncoding: 'identity' });
        expect(reached).toEqual([]);
    }));

    it('lets plain bodies through, with the identity variants rewritten', () => withServer(async (server, reached) => {
        expect((await request(server, {})).status).toBe(200);
        expect((await request(server, { 'content-encoding': ' Identity ' })).body).toBe('handled');
        expect(reached).toEqual(['undefined', 'identity']);
    }));
});
