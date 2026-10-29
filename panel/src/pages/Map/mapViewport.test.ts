import { suite, it, expect } from 'vitest';
import { MIN_ZOOM, MAX_ZOOM, getImageBox, clampView, zoomAtPoint } from './mapViewport';
import { MAP_ASPECT } from './mapGeo';

const size = { w: 1000, h: 600 };
const fitHeight = Math.min(size.h, size.w / MAP_ASPECT); //600

suite('getImageBox', () => {
    it('centers the image at zoom 1, fitted to the height', () => {
        const box = getImageBox({ zoom: 1, x: 0, y: 0 }, size);
        expect(box.height).toBeCloseTo(600);
        expect(box.width).toBeCloseTo(600 * MAP_ASPECT);
        expect(box.left).toBeCloseTo((1000 - box.width) / 2);
        expect(box.top).toBeCloseTo(0);
    });

    it('is empty until the container has been measured', () => {
        const box = getImageBox({ zoom: 1, x: 0, y: 0 }, { w: 0, h: 0 });
        expect(box.width).toBe(0);
        expect(box.height).toBe(0);
    });
});

suite('clampView', () => {
    it('cannot pan at zoom 1, the whole image is in view', () => {
        expect(clampView({ zoom: 1, x: 500, y: -500 }, size)).toEqual({ zoom: 1, x: 0, y: 0 });
    });

    it('limits the pan so the image always covers the container once zoomed', () => {
        const v = clampView({ zoom: 3, x: 99999, y: -99999 }, size);
        const box = getImageBox(v, size);
        expect(box.left).toBeLessThanOrEqual(0.0001);
        expect(box.left + box.width).toBeGreaterThanOrEqual(1000 - 0.0001);
        expect(box.top).toBeLessThanOrEqual(0.0001);
        expect(box.top + box.height).toBeGreaterThanOrEqual(600 - 0.0001);
    });

    it('keeps the zoom inside its limits', () => {
        expect(clampView({ zoom: 0.1, x: 0, y: 0 }, size).zoom).toBe(MIN_ZOOM);
        expect(clampView({ zoom: 500, x: 0, y: 0 }, size).zoom).toBe(MAX_ZOOM);
    });
});

suite('zoomAtPoint', () => {
    it('keeps the spot under the cursor in place while zooming in', () => {
        const start = { zoom: 2, x: 30, y: -20 };
        const cursor = { x: 420, y: 250 };
        const before = getImageBox(clampView(start, size), size);
        const rx = (cursor.x - before.left) / before.width;
        const ry = (cursor.y - before.top) / before.height;
        const next = zoomAtPoint(start, 1.25, cursor, size);
        const after = getImageBox(next, size);
        expect(next.zoom).toBeCloseTo(2.5);
        expect((cursor.x - after.left) / after.width).toBeCloseTo(rx, 6);
        expect((cursor.y - after.top) / after.height).toBeCloseTo(ry, 6);
    });

    it('stops at the zoom limits', () => {
        expect(zoomAtPoint({ zoom: MAX_ZOOM, x: 0, y: 0 }, 1.25, { x: 10, y: 10 }, size).zoom).toBe(MAX_ZOOM);
        expect(zoomAtPoint({ zoom: MIN_ZOOM, x: 0, y: 0 }, 0.8, { x: 10, y: 10 }, size)).toEqual({ zoom: MIN_ZOOM, x: 0, y: 0 });
    });

    it('never leaves the image uncovered after zooming out', () => {
        const next = zoomAtPoint({ zoom: 4, x: 400, y: 200 }, 0.5, { x: 900, y: 500 }, size);
        const box = getImageBox(next, size);
        expect(box.top).toBeLessThanOrEqual(0.0001);
        expect(box.top + box.height).toBeGreaterThanOrEqual(600 - 0.0001);
    });
});
void fitHeight;
