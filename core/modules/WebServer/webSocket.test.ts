//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

const consoleHandler = vi.hoisted(() => vi.fn());
vi.mock('./authLogic', () => ({ checkRequestAuth: vi.fn() }));
vi.mock('./wsRooms/status', () => ({ default: { permission: true, cumulativeBuffer: false, outBuffer: null } }));
vi.mock('./wsRooms/dashboard', () => ({ default: { permission: true, cumulativeBuffer: false, outBuffer: null } }));
vi.mock('./wsRooms/playerlist', () => ({ default: { permission: true, cumulativeBuffer: false, outBuffer: null } }));
vi.mock('./wsRooms/serverlog', () => ({ default: { permission: true, cumulativeBuffer: false, outBuffer: null } }));
vi.mock('./wsRooms/liveconsole', () => ({
    default: {
        permission: 'console.view',
        eventName: 'consoleData',
        cumulativeBuffer: true,
        outBuffer: '',
        initialData: () => '',
        commands: {
            consoleCommand: { permission: 'console.write', handler: consoleHandler },
        },
    },
}));

import WebSocket from './webSocket';
import { checkRequestAuth } from './authLogic';


const buildSocket = (name: string, rooms: string[] = []) => {
    const handlers: Record<string, Function> = {};
    return {
        id: name,
        handshake: { headers: { who: name }, query: { rooms: 'liveconsole' } },
        request: { socket: { remoteAddress: '127.0.0.1' } },
        sessTools: {},
        rooms: new Set([name, ...rooms]),
        handlers,
        on: vi.fn((event: string, fn: Function) => { handlers[event] = fn; }),
        join(room: string) { this.rooms.add(room); },
        emit: vi.fn(),
        disconnect: vi.fn(),
        leave: vi.fn(),
    };
};

const authedAdmin = (perms: string[]) => ({
    name: 'admin',
    getAuthData: () => ({ ok: true }),
    hasPermission: (perm: string) => perms.includes(perm),
});

const buildIo = (sockets: any[] = []) => ({
    fetchSockets: async () => sockets,
    to: () => ({ emit: vi.fn() }),
    emit: vi.fn(),
});

suite('WebSocket', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        consoleHandler.mockClear();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    suite('reCheckAdminAuths', () => {
        it('keeps rechecking the other sockets after dropping an invalid session', async () => {
            const revoked = buildSocket('revoked');
            const stillValid = buildSocket('valid');
            vi.mocked(checkRequestAuth).mockImplementation((headers: any) => {
                return headers.who === 'revoked'
                    ? { success: false }
                    : { success: true, admin: authedAdmin([]) };
            });
            const ws = new WebSocket(buildIo([revoked, stillValid]) as any);
            await ws.reCheckAdminAuths();
            expect(revoked.disconnect).toHaveBeenCalled();
            expect(stillValid.emit).toHaveBeenCalledWith('updateAuthData', { ok: true });
        });

        it('drops every socket of an admin that lost its session', async () => {
            const first = buildSocket('first');
            const second = buildSocket('second');
            vi.mocked(checkRequestAuth).mockReturnValue({ success: false });
            const ws = new WebSocket(buildIo([first, second]) as any);
            await ws.reCheckAdminAuths();
            expect(first.disconnect).toHaveBeenCalled();
            expect(second.disconnect).toHaveBeenCalled();
        });
    });

    suite('room commands', () => {
        it('runs the console command while the admin still has the permission', () => {
            const socket = buildSocket('s1');
            vi.mocked(checkRequestAuth).mockReturnValue({ success: true, admin: authedAdmin(['console.view', 'console.write']) });
            new WebSocket(buildIo() as any).handleConnection(socket as any);
            socket.handlers.consoleCommand('status');
            expect(consoleHandler).toHaveBeenCalledTimes(1);
        });

        it('ignores the console command after the admin lost console.write', () => {
            const socket = buildSocket('s1');
            vi.mocked(checkRequestAuth).mockReturnValue({ success: true, admin: authedAdmin(['console.view', 'console.write']) });
            new WebSocket(buildIo() as any).handleConnection(socket as any);
            vi.mocked(checkRequestAuth).mockReturnValue({ success: true, admin: authedAdmin(['console.view']) });
            socket.handlers.consoleCommand('status');
            expect(consoleHandler).not.toHaveBeenCalled();
        });

        it('ignores the console command after the session was invalidated', () => {
            const socket = buildSocket('s1');
            vi.mocked(checkRequestAuth).mockReturnValue({ success: true, admin: authedAdmin(['console.view', 'console.write']) });
            new WebSocket(buildIo() as any).handleConnection(socket as any);
            vi.mocked(checkRequestAuth).mockReturnValue({ success: false });
            socket.handlers.consoleCommand('status');
            expect(consoleHandler).not.toHaveBeenCalled();
        });
    });
});
