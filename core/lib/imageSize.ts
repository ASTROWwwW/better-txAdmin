/**
 * Reads the size an image declares in its header, without decoding it. The frames of a player screen are sent by
 * the player's game client, which can be modified: a tiny file that declares 30000x30000 pixels would make the
 * browser of the admin allocate gigabytes to show it. Only jpeg and png are read.
 */

export const MAX_SIDE = 4096;
export const MAX_PIXELS = 8_500_000; //a bit more than 3840x2160
const MAX_SEGMENTS = 64; //a frame header is among the first ones, there is no reason to walk a file that has thousands

export type ImageSize = { type: 'jpeg' | 'png'; width: number; height: number };

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const readPng = (data: Buffer): ImageSize | null => {
    //signature (8), chunk length (4), 'IHDR' (4), width (4), height (4)
    if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    if (data.toString('latin1', 12, 16) !== 'IHDR') return null;
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    if (width === 0 || height === 0) return null;
    return { type: 'png', width, height };
};

const isFrameMarker = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

const readJpeg = (data: Buffer): ImageSize | null => {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
    let pos = 2;
    for (let segments = 0; segments < MAX_SEGMENTS; segments++) {
        //markers can be padded with 0xff
        while (pos < data.length && data[pos] === 0xff && data[pos + 1] === 0xff) pos++;
        if (pos + 1 >= data.length || data[pos] !== 0xff) return null;
        const marker = data[pos + 1];
        pos += 2;
        if (marker === 0xd9 || marker === 0xda) return null; //end of image, or the scan started without a frame header
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; //no length

        if (pos + 2 > data.length) return null;
        const length = data.readUInt16BE(pos);
        if (length < 2) return null;
        if (isFrameMarker(marker)) {
            //length (2), precision (1), height (2), width (2)
            if (length < 8 || pos + 7 > data.length) return null;
            const height = data.readUInt16BE(pos + 3);
            const width = data.readUInt16BE(pos + 5);
            if (width === 0 || height === 0) return null;
            return { type: 'jpeg', width, height };
        }
        pos += length;
    }
    return null;
};

export const getImageSize = (data: Buffer): ImageSize | null => {
    return readJpeg(data) ?? readPng(data);
};

/**
 * True if the image declares a size that is safe to show.
 */
export const isSafeImage = (data: Buffer): boolean => {
    const size = getImageSize(data);
    if (!size) return false;
    return size.width <= MAX_SIDE && size.height <= MAX_SIDE && size.width * size.height <= MAX_PIXELS;
};
