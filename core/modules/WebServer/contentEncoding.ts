/**
 * CVE-2026-111497 mitigation: only plain (identity) request bodies are accepted, Koa and
 * Socket.IO never get to decode a compressed one.
 * Returns false when the request must be refused with a 415.
 * When the header is a case/whitespace variant of `identity` it is rewritten to `identity`,
 * so the parsers downstream recognize it too.
 */
export const acceptIdentityOnly = (headers: Record<string, unknown>): boolean => {
    const contentEncoding = headers['content-encoding'];
    if (contentEncoding === undefined) return true;
    if (typeof contentEncoding !== 'string' || contentEncoding.trim().toLowerCase() !== 'identity') {
        return false;
    }
    headers['content-encoding'] = 'identity';
    return true;
};


/**
 * Answers 415 and returns true when the request carries an encoded body, for the HTTP callback to stop there.
 */
export const rejectEncodedBody = (req: { headers: Record<string, unknown> }, res: { writeHead: Function, end: Function }): boolean => {
    if (acceptIdentityOnly(req.headers)) return false;
    res.writeHead(415, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Accept-Encoding': 'identity',
    });
    res.end('Unsupported Content-Encoding');
    return true;
};
