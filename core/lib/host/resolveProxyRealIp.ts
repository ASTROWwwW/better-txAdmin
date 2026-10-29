import { isIP, isIPv4 } from 'node:net';
import { txHostConfig } from '@core/globalData';
import { isIpInRanges } from '@lib/host/isIpInRanges';


/**
 * Returned when the proxy did not give a client address we can read.
 * It is not a local address, so such requests are never exempted from the rate limiter.
 */
export const UNRESOLVED_CLIENT_IP = 'unresolved';

const MAPPED_PREFIX = '::ffff:';


/**
 * Reads an X-Forwarded-For entry, accepting what real proxies append:
 * ipv4, ipv6, `ip:port`, `[ipv6]:port` and ipv4-mapped ipv6. Returns undefined if unreadable.
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
    if (ip.toLowerCase().startsWith(MAPPED_PREFIX) && isIPv4(ip.slice(MAPPED_PREFIX.length))) {
        ip = ip.slice(MAPPED_PREFIX.length);
    }
    return isIP(ip) ? ip : undefined;
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
    for (let i = entries.length - 1; i >= 0; i--) {
        const ip = parseForwardedEntry(entries[i]);
        if (ip === undefined) return UNRESOLVED_CLIENT_IP;
        if (!isIpInRanges(ip, proxyIpRanges)) {
            return ip;
        }
    }

    // All IPs in the chain are trusted proxies — return the leftmost
    return parseForwardedEntry(entries[0]) ?? UNRESOLVED_CLIENT_IP;
};
