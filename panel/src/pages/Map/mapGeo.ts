/**
 * The satellite image of the GTA V map and how game coordinates land on it.
 * NOTE: the image is the original 5944x8075 satellite map downscaled to 3000x4076.
 */
export const MAP_IMAGE_PATH = 'img/map-satellite.jpg';
export const MAP_ASPECT = 3000 / 4076; //width over height
export const MAP_BOUNDS = { left: -3932, right: 5095, top: 8297, bottom: -3959 };

export type MapRatio = { rx: number; ry: number }; //0..1 from the left and from the top of the image

export const gameToMapRatio = (x: number, y: number): MapRatio => ({
    rx: (x - MAP_BOUNDS.left) / (MAP_BOUNDS.right - MAP_BOUNDS.left),
    ry: (MAP_BOUNDS.top - y) / (MAP_BOUNDS.top - MAP_BOUNDS.bottom),
});

export const isOnMap = ({ rx, ry }: MapRatio) => rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1;
