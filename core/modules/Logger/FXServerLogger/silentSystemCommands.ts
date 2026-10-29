//System commands that are not written to the console and the log. The first one is typed by admins in the
//console (it is logged as their command already), the others are sent again and again while a map or a screen
//viewer is open, and the stream start carries the secret upload token of the player's game.
const SILENT_EVENTS = [
    'consoleCommand',
    'playerPositionsWanted',
    'screenshotRequested',
    'screenStreamStart',
    'screenStreamStop',
];

export const isSilentSystemCommand = (cmd: string) => {
    return SILENT_EVENTS.some((event) => cmd.startsWith(`txaEvent "${event}"`));
};
