import { GameStream } from './streamLoop';
import { parseStreamMessage } from './parseMessage';
import { createWebglSource } from './webglSource';
import { sendFrame } from './sendFrame';

/**
 * Listens to the start and stop messages of the game (cl_stream.lua) and runs the live view.
 * The page has no visible part for this, it only sends frames of the game screen to the server.
 */
export const installGameStreamListener = () => {
    const stream = new GameStream({
        source: createWebglSource(),
        send: sendFrame,
        now: () => performance.now(),
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    });
    window.addEventListener('message', (event: MessageEvent) => {
        const message = parseStreamMessage(event.data, event.source, window);
        if (message?.type === 'start') stream.start(message.cfg);
        else if (message?.type === 'stop') stream.stop();
    });
};
