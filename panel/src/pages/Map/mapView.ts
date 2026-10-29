import { MAP_ASPECT } from './mapGeo';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 10;

export type MapSize = { w: number; h: number }; //the container, in px
export type MapView = { zoom: number; x: number; y: number }; //x, y: pan from the centered position, in px
export type ImageBox = { left: number; top: number; width: number; height: number };

const getFitHeight = (size: MapSize) => Math.min(size.h, size.w / MAP_ASPECT);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Keeps the zoom inside its limits and the pan so the image always covers the container.
 */
export const clampView = (view: MapView, size: MapSize): MapView => {
    const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
    const fitHeight = getFitHeight(size);
    const maxX = Math.max(0, (fitHeight * zoom * MAP_ASPECT - size.w) / 2);
    const maxY = Math.max(0, (fitHeight * zoom - size.h) / 2);
    //`|| 0` also turns the -0 of an empty range (and a NaN pan) into 0
    return { zoom, x: clamp(view.x, -maxX, maxX) || 0, y: clamp(view.y, -maxY, maxY) || 0 };
};

/**
 * Where the image sits in the container, in px.
 */
export const getImageBox = (view: MapView, size: MapSize): ImageBox => {
    const v = clampView(view, size);
    const height = getFitHeight(size) * v.zoom;
    const width = height * MAP_ASPECT;
    return {
        left: (size.w - width) / 2 + v.x,
        top: (size.h - height) / 2 + v.y,
        width,
        height,
    };
};

/**
 * Zooms by `factor` keeping the spot under the cursor (container px) where it is.
 */
export const zoomAtPoint = (view: MapView, factor: number, cursor: { x: number; y: number }, size: MapSize): MapView => {
    const current = clampView(view, size);
    const box = getImageBox(current, size);
    const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = zoom / current.zoom;
    const newLeft = cursor.x - (cursor.x - box.left) * k;
    const newTop = cursor.y - (cursor.y - box.top) * k;
    const newHeight = getFitHeight(size) * zoom;
    const newWidth = newHeight * MAP_ASPECT;
    return clampView({
        zoom,
        x: newLeft - (size.w - newWidth) / 2,
        y: newTop - (size.h - newHeight) / 2,
    }, size);
};
