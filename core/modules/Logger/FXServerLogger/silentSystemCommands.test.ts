import { suite, it, expect } from 'vitest';
import { isSilentSystemCommand } from './silentSystemCommands';

suite('isSilentSystemCommand', () => {
    it.each([
        'txaEvent "consoleCommand" "{\\"author\\":\\"a\\",\\"command\\":\\"x\\"}"',
        'txaEvent "playerPositionsWanted" "{\\"ttlMs\\":20000}"',
        'txaEvent "screenshotRequested" "{\\"reqId\\":\\"abc\\",\\"netid\\":12,\\"quality\\":0.4}"',
        'txaEvent "screenStreamStart" "{\\"sessionId\\":\\"s\\",\\"token\\":\\"secret-upload-token\\"}"',
        'txaEvent "screenStreamStop" "{\\"sessionId\\":\\"s\\"}"',
    ])('keeps this out of the console and the log: %s', (cmd) => {
        expect(isSilentSystemCommand(cmd)).toBe(true);
    });

    it.each([
        'txaEvent "announcement" "{\\"message\\":\\"hi\\"}"',
        'txaEvent "playerKicked" "{}"',
        'txaEvent "scheduledRestart" "{}"',
        'say hello',
        'ensure monitor',
        '',
    ])('still shows %j', (cmd) => {
        expect(isSilentSystemCommand(cmd)).toBe(false);
    });

    it('matches the whole event name, not a prefix of it', () => {
        expect(isSilentSystemCommand('txaEvent "screenStreamStartX" "{}"')).toBe(false);
        expect(isSilentSystemCommand('txaEvent "playerPositionsWantedLater" "{}"')).toBe(false);
        expect(isSilentSystemCommand('txaEvent screenStreamStart "{}"')).toBe(false); //not the quoted form txAdmin writes
    });

    it('does not hide a command that only mentions an event further in the line', () => {
        expect(isSilentSystemCommand('say txaEvent "screenStreamStart" "{}"')).toBe(false);
    });
});
