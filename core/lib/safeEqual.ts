import { timingSafeEqual } from 'node:crypto';

export const safeEqual = (received: unknown, expected: string) => {
    if (typeof received !== 'string') return false;
    const bufReceived = Buffer.from(received);
    const bufExpected = Buffer.from(expected);
    return bufReceived.length === bufExpected.length && timingSafeEqual(bufReceived, bufExpected);
};
