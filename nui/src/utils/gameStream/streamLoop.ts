//The loop of the live view on the game side: capture a frame, send it, wait for the answer, repeat.
//It knows nothing about WebGL or fetch, they are given to it, so it can be tested alone.

export type StreamStart = {
    url: string;
    fps: number;
    width: number;
    quality: number;
    ttlMs: number;
};

export type FrameSource = {
    //A jpeg as base64 (without the data: prefix), or null if there is nothing to send
    capture: (width: number, quality: number) => Promise<string | null>;
    release?: () => void;
};

export type SendResult = 'ok' | 'stop' | 'error';

export type StreamDeps = {
    source: FrameSource;
    send: (url: string, frame: string) => Promise<SendResult>;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
};

const MAX_FAILURES_IN_A_ROW = 5;
const MAX_FAILURE_WAIT_MS = 2000;
//The next frame is captured without waiting for the answer to the last one, otherwise the fps could not
//be higher than 1 / (round trip to the server + encoding). More than 2 would only pile up on a slow link.
const MAX_IN_FLIGHT = 2;

const clamp = (value: number, low: number, high: number, fallback: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(high, Math.max(low, value));
};


export class GameStream {
    #deps: StreamDeps;
    #runId = 0;
    #running = false;
    #wake: (() => void) | undefined;

    constructor(deps: StreamDeps) {
        this.#deps = deps;
    }

    get running() {
        return this.#running;
    }

    /**
     * Starts a stream, replacing the one that runs. The old loop sends nothing after this.
     */
    start(cfg: StreamStart) {
        this.#wake?.();
        const runId = ++this.#runId;
        this.#running = true;
        const settings = {
            url: cfg.url,
            fps: clamp(cfg.fps, 5, 20, 12),
            width: clamp(cfg.width, 320, 1280, 640),
            quality: clamp(cfg.quality, 0.2, 0.8, 0.5),
            ttlMs: clamp(cfg.ttlMs, 1000, 11 * 60_000, 11 * 60_000),
        };
        void this.#run(runId, settings);
    }

    stop() {
        this.#wake?.();
        this.#runId++;
        if (this.#running) {
            this.#running = false;
            this.#deps.source.release?.();
        }
    }

    /**
     * Ends the run if it is still the current one. The loop notices at its next step.
     */
    #end(runId: number) {
        if (runId !== this.#runId) return;
        this.#runId++;
        this.#running = false;
        this.#deps.source.release?.();
        this.#wake?.();
    }

    async #run(runId: number, settings: StreamStart) {
        const { source, send, now, sleep } = this.#deps;
        const startedAt = now();
        const frameMs = Math.round(1000 / settings.fps);
        let failures = 0;
        let inFlight = 0;

        const onAnswer = (result: SendResult) => {
            inFlight--;
            if (runId !== this.#runId) return;
            if (result === 'stop') return this.#end(runId);
            failures = result === 'ok' ? 0 : failures + 1;
            if (failures >= MAX_FAILURES_IN_A_ROW) return this.#end(runId);
            this.#wake?.();
        };

        while (runId === this.#runId && now() - startedAt < settings.ttlMs) {
            //Wait for one of the frames on their way to be answered
            while (inFlight >= MAX_IN_FLIGHT && runId === this.#runId) {
                await new Promise<void>((resolve) => { this.#wake = resolve; });
            }
            if (runId !== this.#runId) return;

            const frameStart = now();
            let frame: string | null = null;
            try {
                frame = await source.capture(settings.width, settings.quality);
            } catch {
                frame = null;
            }
            if (runId !== this.#runId) return;

            if (frame) {
                inFlight++;
                send(settings.url, frame).then(onAnswer, () => onAnswer('error'));
            } else {
                failures++;
                if (failures >= MAX_FAILURES_IN_A_ROW) break;
            }

            const wait = failures
                ? Math.min(MAX_FAILURE_WAIT_MS, 250 * 2 ** (failures - 1))
                : Math.max(0, frameMs - (now() - frameStart));
            await sleep(wait);
        }

        this.#end(runId);
    }
}
