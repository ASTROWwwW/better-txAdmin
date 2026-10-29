import { isIP } from 'node:net';
import { txHostConfig } from '@core/globalData';
import { isIpInRanges } from '@lib/host/isIpInRanges';


/**
 * Prefix of what is returned when the proxy did not give a client address we can read.
 * It is followed by the address of the proxy socket, so those clients share a rate limit bucket
 * with the other unreadable clients of the same proxy, not with the ones of another proxy.
 * It is not a local address, so such requests are never exempted from the rate limiter.
 */
export const UNRESOLVED_CLIENT_IP = 'unresolved';


/**
 * The WHATWG URL parser prints every notation of an ipv6 address in one canonical form,
 * and an ipv4-mapped one as `::ffff:hhhh:hhhh`, which we turn back into dotted ipv4.
 */
const canonicalizeIpv6 = (ip: string) => {
    let canonical: string;
    try {
        canonical = new URL(`http://[${ip}]`).hostname.slice(1, -1);
    } catch (error) {
        return undefined;
    }
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
    if (!mapped) return canonical;
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
};


/**
 * Reads an X-Forwarded-For entry, accepting what real proxies append:
 * ipv4, ipv6 (any notation), `ip:port`, `[ipv6]:port` and ipv4-mapped ipv6.
 * Returns undefined if unreadable. Zone ids (`%eth0`) are not accepted.
 */
const parseForwardedEntry = (raw: string) => {
    let ip = raw.trim();
    const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(ip);
    const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(ip);
    if (bracketed) {
        ip = bracketed[1];
    } else if (withPort) {
        ip = withPort[1];
    }
    if (ip.includes('%')) return undefined;
    const family = isIP(ip);
    if (family === 4) return ip;
    if (family === 6) return canonicalizeIpv6(ip);
    return undefined;
};


/**
 * Resolves the real client IP from X-Forwarded-For header when the
 * direct connection IP is a trusted proxy. Returns undefined if proxy support
 * is not configured, the source is not trusted, or there is no header.
 *
 * When there are multiple proxies, we walk X-Forwarded-For from right
 * to left, skipping trusted proxy IPs, and return the first untrusted one.
 * The first entry that is not a trusted proxy is where the real client sits: if it cannot
 * be read we stop there (UNRESOLVED_CLIENT_IP) instead of falling back to an entry on its
 * left, since those are written by the client and can be forged.
 */
export const resolveProxyRealIp = (socketIp: string, xffHeader: string | undefined) => {
    const { proxyIpRanges } = txHostConfig;
    if (!proxyIpRanges || !isIpInRanges(socketIp, proxyIpRanges)) {
        return undefined;
    }

    if (!xffHeader) return undefined;

    // X-Forwarded-For: client, proxy1, proxy2
    // Walk from right to left, skipping trusted proxies
    const entries = xffHeader.split(',');
    let leftmost: string | undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
        const ip = parseForwardedEntry(entries[i]);
        if (ip === undefined) return `${UNRESOLVED_CLIENT_IP}:${socketIp}`;
        if (!isIpInRanges(ip, proxyIpRanges)) {
            return ip;
        }
        leftmost = ip;
    }

    // All IPs in the chain are trusted proxies — return the leftmost (split() always yields one entry)
    return leftmost as string;
};
