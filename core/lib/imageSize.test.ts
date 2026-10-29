import { suite, it, describe, expect } from 'vitest';
import { getImageSize, isSafeImage, MAX_SIDE, MAX_PIXELS } from './imageSize';

//Only the headers are read, so a few bytes are enough to describe an image
const be16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const jpeg = (width: number, height: number, { app0 = true, sof = 0xc0, sos = true, eoi = true }: { app0?: boolean; sof?: number; sos?: boolean; eoi?: boolean } = {}) => Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0 ? Buffer.concat([Buffer.from([0xff, 0xe0]), be16(16), Buffer.alloc(14, 1)]) : Buffer.alloc(0),
    Buffer.from([0xff, sof]), be16(17), Buffer.from([8]), be16(height), be16(width), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    sos ? Buffer.concat([Buffer.from([0xff, 0xda]), be16(8), Buffer.alloc(6, 2), Buffer.alloc(20, 3)]) : Buffer.alloc(0),
    eoi ? Buffer.from([0xff, 0xd9]) : Buffer.alloc(0),
]);
const png = (width: number, height: number) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), ihdr, Buffer.alloc(4), Buffer.alloc(30), Buffer.from('IEND')]);
};

suite('getImageSize', () => {
    describe('jpeg', () => {
        it('reads the size of a baseline jpeg', () => {
            expect(getImageSize(jpeg(640, 360))).toEqual({ type: 'jpeg', width: 640, height: 360 });
        });

        it.each([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc9, 0xcf])('reads a start of frame of kind %i', (sof) => {
            expect(getImageSize(jpeg(1280, 720, { sof }))).toEqual({ type: 'jpeg', width: 1280, height: 720 });
        });

        it('does not take the marker of the huffman tables (C4), the jpeg extension (C8) or the arithmetic conditioning (CC) for a frame', () => {
            for (const sof of [0xc4, 0xc8, 0xcc]) expect(getImageSize(jpeg(640, 360, { sof }))).toBeNull();
        });

        it('works without an APP0 segment, and after other segments are skipped', () => {
            expect(getImageSize(jpeg(300, 200, { app0: false }))).toEqual({ type: 'jpeg', width: 300, height: 200 });
        });

        it('skips fill bytes between markers', () => {
            const j = jpeg(640, 360);
            const padded = Buffer.concat([j.subarray(0, 2), Buffer.from([0xff, 0xff, 0xff]), j.subarray(2)]);
            expect(getImageSize(padded)).toEqual({ type: 'jpeg', width: 640, height: 360 });
        });

        it('has no size when the scan starts before any frame header', () => {
            const noFrame = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda]), be16(8), Buffer.alloc(30), Buffer.from([0xff, 0xd9])]);
            expect(getImageSize(noFrame)).toBeNull();
        });

        it('does not accept a frame header that comes after the scan started (the decoder would not see it)', () => {
            const scanFirst = Buffer.concat([
                Buffer.from([0xff, 0xd8]),
                Buffer.from([0xff, 0xda]), be16(8), Buffer.alloc(6, 2),
                Buffer.from([0xff, 0xc0]), be16(17), Buffer.from([8]), be16(360), be16(640), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
                Buffer.from([0xff, 0xd9]),
            ]);
            expect(getImageSize(scanFirst)).toBeNull();
        });

        it.each([
            ['empty', Buffer.alloc(0)],
            ['one byte', Buffer.from([0xff])],
            ['not an image', Buffer.from('hello world')],
            ['only the start', Buffer.from([0xff, 0xd8])],
            ['a segment that is longer than the data', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 1, 2])],
            ['a segment length of 0 or 1 (it would never move forward)', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9])],
            ['a frame header that is cut', Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 1])],
        ])('has no size for %s', (_label, data) => {
            expect(getImageSize(data)).toBeNull();
        });

        it('has no size for a size of 0', () => {
            expect(getImageSize(jpeg(0, 360))).toBeNull();
            expect(getImageSize(jpeg(640, 0))).toBeNull();
        });

        it('is not slow on a long run of segments', () => {
            const segs = Buffer.concat(Array.from({ length: 20000 }, () => Buffer.concat([Buffer.from([0xff, 0xfe]), be16(4), Buffer.from([1, 2])])));
            const data = Buffer.concat([Buffer.from([0xff, 0xd8]), segs, Buffer.from([0xff, 0xd9])]);
            const t = Date.now();
            expect(getImageSize(data)).toBeNull();
            expect(Date.now() - t).toBeLessThan(200);
        });
    });

    describe('png', () => {
        it('reads the size from the header chunk', () => {
            expect(getImageSize(png(320, 180))).toEqual({ type: 'png', width: 320, height: 180 });
        });

        it('needs the png signature, the header chunk alone is not enough', () => {
            const notPng = png(320, 180);
            notPng[1] = 0x51; //a wrong byte in the signature
            expect(getImageSize(notPng)).toBeNull();
            expect(getImageSize(Buffer.concat([Buffer.alloc(8), png(320, 180).subarray(8)]))).toBeNull();
        });

        it('has no size for a signature without a header chunk, or a cut one', () => {
            expect(getImageSize(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBeNull();
            expect(getImageSize(png(320, 180).subarray(0, 20))).toBeNull();
            const wrongChunk = png(320, 180);
            wrongChunk.write('IDAT', 12);
            expect(getImageSize(wrongChunk)).toBeNull();
        });

        it('reads big sizes without overflowing', () => {
            expect(getImageSize(png(4294967295, 4294967295))).toEqual({ type: 'png', width: 4294967295, height: 4294967295 });
        });
    });
});

suite('isSafeImage', () => {
    it('accepts a normal screen, up to 4K', () => {
        expect(isSafeImage(jpeg(640, 360))).toBe(true);
        expect(isSafeImage(jpeg(1280, 720))).toBe(true);
        expect(isSafeImage(jpeg(3840, 2160))).toBe(true);
        expect(isSafeImage(png(1920, 1080))).toBe(true);
    });

    it('refuses what would be decoded into gigapixels by the browser of the admin', () => {
        expect(isSafeImage(jpeg(30000, 30000))).toBe(false);
        expect(isSafeImage(jpeg(65535, 65535))).toBe(false);
        expect(isSafeImage(png(30000, 30000))).toBe(false);
        expect(isSafeImage(png(4294967295, 1))).toBe(false);
    });

    it('refuses a side above the limit even when the area is small', () => {
        expect(isSafeImage(jpeg(MAX_SIDE + 1, 100))).toBe(false);
        expect(isSafeImage(jpeg(100, MAX_SIDE + 1))).toBe(false);
        expect(isSafeImage(jpeg(MAX_SIDE, 100))).toBe(true);
    });

    it('refuses an area above the limit even when each side is allowed', () => {
        expect(MAX_SIDE * MAX_SIDE).toBeGreaterThan(MAX_PIXELS);
        expect(isSafeImage(jpeg(MAX_SIDE, MAX_SIDE))).toBe(false);
    });

    it('refuses what has no readable size', () => {
        expect(isSafeImage(Buffer.from('hello'))).toBe(false);
        expect(isSafeImage(jpeg(640, 360, { sof: 0xc4 }))).toBe(false);
    });
});
