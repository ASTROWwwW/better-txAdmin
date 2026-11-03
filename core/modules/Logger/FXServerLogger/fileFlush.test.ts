//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@core/globalData', () => ({ txHostConfig: { forceQuietMode: true } }));

import FXServerLogger from './index';
import ConsoleLineEnum from './ConsoleLineEnum';


const makeLogger = () => {
    const logger = new FXServerLogger('/tmp/txtest-fxserver-logger', false);
    const write = vi.fn();
    logger.lrStream = { write };
    return { logger, write };
};

const written = (write) => write.mock.calls.map((call) => call[0]).join('');


suite('FXServerLogger file flush', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('txConfig', { server: { quiet: true } });
        vi.stubGlobal('txCore', { webServer: { webSocket: { buffer: vi.fn() } } });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('writes the output to the file every second', () => {
        const { logger, write } = makeLogger();
        logger.writeFxsOutput(ConsoleLineEnum.StdOut, 'hello world\n');
        vi.advanceTimersByTime(999);
        expect(write).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(written(write)).toContain('hello world');
    });

    it('does not wait five seconds to write the file', () => {
        const { logger, write } = makeLogger();
        logger.writeFxsOutput(ConsoleLineEnum.StdOut, 'first\n');
        vi.advanceTimersByTime(1000);
        logger.writeFxsOutput(ConsoleLineEnum.StdOut, 'second\n');
        vi.advanceTimersByTime(1000);
        expect(write.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(written(write)).toContain('first');
        expect(written(write)).toContain('second');
    });

    it('removes the color sequences of the console from the file', () => {
        const { logger, write } = makeLogger();
        logger.writeFxsOutput(ConsoleLineEnum.StdOut, '\x1B[31mred\x1B[0m \x1B[38;2;255;255;255;48;2;255;255;255;1;4mlong\x1B[0m plain\n');
        vi.advanceTimersByTime(1000);
        const text = written(write);
        expect(text).toContain('red long plain');
        expect(text).not.toContain('\x1B[31m');
        expect(text).not.toContain('\x1B[0m');
        expect(text).not.toContain('38;2;255');
    });

    it('keeps the text of lines that only look like a color sequence from far away', () => {
        const { logger, write } = makeLogger();
        const farText = 'x'.repeat(100);
        logger.writeFxsOutput(ConsoleLineEnum.StdOut, `a \x1B${farText} m b\n`);
        vi.advanceTimersByTime(1000);
        expect(written(write)).toContain(farText);
    });

    it('handles a buffer full of escape characters without a color end in linear time', () => {
        const { logger, write } = makeLogger();
        logger.writeFxsOutput(ConsoleLineEnum.StdOut, '\x1B'.repeat(200_000) + ' end\n');
        const start = performance.now();
        vi.advanceTimersByTime(1000);
        const elapsed = performance.now() - start;
        expect(written(write)).toContain(' end');
        expect(elapsed).toBeLessThan(500);
    });
});
