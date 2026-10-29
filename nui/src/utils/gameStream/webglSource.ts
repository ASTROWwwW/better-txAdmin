import type { FrameSource } from './streamLoop';

//Over this many base64 characters the server drops the frame (400000), so keep some room
const MAX_FRAME_CHARS = 380_000;
const RETRY_QUALITY = 0.3;

/**
 * What the frames are made from: a texture on the WebGL context, and how big the picture it holds is.
 */
export type TextureProvider = {
    init: (gl: WebGLRenderingContext) => WebGLTexture;
    size: () => { width: number; height: number };
};

/**
 * The game screen. The game recognises this exact sequence of calls on a 1x1 texture (the same one the
 * `screenshot-basic` resource gets from the CitizenFX build of three.js, `CfxTexture`) and from then on the
 * texture shows the game's back buffer. It can only be checked in a real game client.
 */
export const gameTextureProvider: TextureProvider = {
    init: (gl) => {
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
        gl.texParameterf(3553, 10243, 33071);
        gl.texParameterf(3553, 10243, 33648);
        gl.texParameterf(3553, 10243, 10497);
        return texture;
    },
    size: () => ({ width: window.innerWidth, height: window.innerHeight }),
};

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
    vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

//Averages up to 4x4 samples per output pixel, a plain downscale would be full of aliasing
const FRAGMENT = `
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uTaps;
varying vec2 vUv;
void main() {
    vec4 sum = vec4(0.0);
    for (int i = 0; i < 4; i++) {
        if (float(i) >= uTaps) break;
        for (int j = 0; j < 4; j++) {
            if (float(j) >= uTaps) break;
            vec2 offset = ((vec2(float(i), float(j)) + 0.5) / uTaps - 0.5) * uStep;
            sum += texture2D(uTex, clamp(vUv + offset, 0.0, 1.0));
        }
    }
    gl_FragColor = vec4(sum.rgb / (uTaps * uTaps), 1.0);
}`;

const compile = (gl: WebGLRenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
};

const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
        const text = String(reader.result);
        resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
});

type GlState = {
    gl: WebGLRenderingContext;
    texture: WebGLTexture;
    uStep: WebGLUniformLocation | null;
    uTaps: WebGLUniformLocation | null;
};


/**
 * Draws the texture at the size of the stream on a canvas (the downscale is done by the graphics card)
 * and encodes that canvas as a jpeg.
 */
export const createWebglSource = (provider: TextureProvider = gameTextureProvider): FrameSource => {
    let canvas: HTMLCanvasElement | undefined;
    let state: GlState | undefined;

    const init = (): GlState => {
        canvas ??= document.createElement('canvas');
        const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
        if (!gl) throw new Error('no webgl');
        canvas.addEventListener('webglcontextlost', () => { state = undefined; }, { once: true });

        const program = gl.createProgram()!;
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program link failed');
        gl.useProgram(program);

        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(program, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        const texture = provider.init(gl);
        gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
        return {
            gl,
            texture,
            uStep: gl.getUniformLocation(program, 'uStep'),
            uTaps: gl.getUniformLocation(program, 'uTaps'),
        };
    };

    const encode = (quality: number) => new Promise<Blob | null>((resolve) => {
        canvas!.toBlob(resolve, 'image/jpeg', quality);
    });

    return {
        capture: (width, quality) => new Promise<string | null>((resolve, reject) => {
            //Drawn in an animation frame, which is when the game gives the page its picture
            requestAnimationFrame(async () => {
                try {
                    state ??= init();
                    const { gl, texture, uStep, uTaps } = state;
                    const source = provider.size();
                    if (!(source.width > 0) || !(source.height > 0)) return resolve(null);

                    const outWidth = Math.max(2, Math.min(Math.round(width), source.width));
                    const outHeight = Math.max(2, Math.round(outWidth * source.height / source.width));
                    if (canvas!.width !== outWidth || canvas!.height !== outHeight) {
                        canvas!.width = outWidth;
                        canvas!.height = outHeight;
                    }
                    gl.viewport(0, 0, outWidth, outHeight);
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, texture);
                    gl.uniform2f(uStep, 1 / outWidth, 1 / outHeight);
                    gl.uniform1f(uTaps, Math.max(1, Math.min(4, Math.ceil(source.width / outWidth))));
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

                    let blob = await encode(quality);
                    let base64 = blob ? await blobToBase64(blob) : null;
                    if (base64 && base64.length > MAX_FRAME_CHARS) {
                        blob = await encode(Math.min(quality, RETRY_QUALITY));
                        base64 = blob ? await blobToBase64(blob) : null;
                        if (base64 && base64.length > MAX_FRAME_CHARS) base64 = null;
                    }
                    resolve(base64);
                } catch (error) {
                    reject(error);
                }
            });
        }),
        release: () => {
            //Keep the context for the next view (browsers only allow a few), drop only the picture
            if (canvas) {
                canvas.width = 2;
                canvas.height = 2;
            }
        },
    };
};
