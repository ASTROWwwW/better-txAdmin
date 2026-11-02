import { suite, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:crypto')>();
    return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import { timingSafeEqual } from 'node:crypto';
import { safeEqual } from './safeEqual';


suite('safeEqual', () => {
    beforeEach(() => {
        vi.mocked(timingSafeEqual).mockClear();
    });

    it('accepts the same string', () => {
        expect(safeEqual('abcdef', 'abcdef')).toBe(true);
    });

    it('compares a string of the same length through timingSafeEqual', () => {
        expect(safeEqual('abcdez', 'abcdef')).toBe(false);
        expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    });

    it('rejects a different length without comparing', () => {
        expect(safeEqual('abcde', 'abcdef')).toBe(false);
        expect(safeEqual('abcdefg', 'abcdef')).toBe(false);
        expect(safeEqual('', 'abcdef')).toBe(false);
        expect(timingSafeEqual).not.toHaveBeenCalled();
    });

    it('rejects anything that is not a string', () => {
        expect(safeEqual(undefined, 'abcdef')).toBe(false);
        expect(safeEqual(null, 'abcdef')).toBe(false);
        expect(safeEqual(['abcdef'], 'abcdef')).toBe(false);
        expect(safeEqual(123456, '123456')).toBe(false);
    });

    it('compares multibyte strings by their bytes', () => {
        expect(safeEqual('añb', 'añb')).toBe(true);
        expect(safeEqual('añb', 'anb')).toBe(false);
    });
});
