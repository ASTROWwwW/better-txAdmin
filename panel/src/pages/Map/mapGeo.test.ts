import { suite, it, expect } from 'vitest';
import { MAP_BOUNDS, MAP_ASPECT, gameToMapRatio, isOnMap } from './mapGeo';

suite('gameToMapRatio', () => {
    it('maps the corners of the map to the corners of the image', () => {
        expect(gameToMapRatio(MAP_BOUNDS.left, MAP_BOUNDS.top)).toEqual({ rx: 0, ry: 0 });
        expect(gameToMapRatio(MAP_BOUNDS.right, MAP_BOUNDS.bottom)).toEqual({ rx: 1, ry: 1 });
    });

    it('puts north (a larger y) higher on the image', () => {
        expect(gameToMapRatio(0, 5000).ry).toBeLessThan(gameToMapRatio(0, -2000).ry);
    });

    it('puts east (a larger x) further right on the image', () => {
        expect(gameToMapRatio(4000, 0).rx).toBeGreaterThan(gameToMapRatio(-2000, 0).rx);
    });

    it('places known spots where they are on the satellite image', () => {
        const losSantos = gameToMapRatio(-250, -900); //downtown
        const sandyShores = gameToMapRatio(1900, 3700);
        const paleto = gameToMapRatio(-120, 6200);
        expect(losSantos.rx).toBeCloseTo(0.41, 1);
        expect(losSantos.ry).toBeCloseTo(0.75, 1);
        expect(sandyShores.ry).toBeLessThan(losSantos.ry);
        expect(paleto.ry).toBeLessThan(sandyShores.ry);
    });
});

suite('isOnMap', () => {
    it('is true inside the bounds and false outside, edges included', () => {
        expect(isOnMap({ rx: 0, ry: 0 })).toBe(true);
        expect(isOnMap({ rx: 1, ry: 1 })).toBe(true);
        expect(isOnMap({ rx: 0.5, ry: 0.5 })).toBe(true);
        expect(isOnMap({ rx: -0.01, ry: 0.5 })).toBe(false);
        expect(isOnMap({ rx: 0.5, ry: 1.01 })).toBe(false);
        expect(isOnMap({ rx: NaN, ry: 0.5 })).toBe(false);
    });
});

suite('MAP_ASPECT', () => {
    it('is the width over the height of the image', () => {
        expect(MAP_ASPECT).toBeCloseTo(3000 / 4076, 6);
    });
});
