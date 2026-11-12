import { expect, it, suite } from 'vitest';
import general from './general';

suite('general.language', () => {
    it('accepts a known locale and the custom locale', () => {
        expect(general.language.validator.safeParse('en').success).toBe(true);
        expect(general.language.validator.safeParse('custom').success).toBe(true);
    });

    it('names the rejected language code in the error', () => {
        const res = general.language.validator.safeParse('zz-nope');
        expect(res.success).toBe(false);
        expect(res.error!.issues[0].message).toBe('Invalid language code `zz-nope`.');
    });
});
