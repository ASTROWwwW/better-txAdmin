import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ImageIcon, Loader2Icon, RefreshCwIcon } from 'lucide-react';
import { ApiTimeout, useBackendApi } from '@/hooks/fetch';
import type { GenericApiOkResp } from '@shared/genericApiTypes';
import type { ApiPlayerScreenStreamStartResp, ApiPlayerScreenStreamStatusResp } from '@shared/playerApiTypes';
import {
    buildStreamImageUrl,
    DEFAULT_PRESET,
    getStreamStep,
    STATUS_PERIOD_MS,
    STREAM_PRESETS,
    type StreamPresetKey,
    type StreamStep,
} from './streamStatus';

type ScreenStreamViewProps = {
    mutex: string;
    netid: number;
    displayName: string;
    onClose: () => void;
    onFallback: (notice: string) => void; //the player's game cannot stream: use the screenshots
    onSnapshots: () => void; //the admin chose the screenshots
};

type Session = { sessionId: string; viewToken: string };


/**
 * The smooth live view: the player's game sends small images to txAdmin, which relays them to this page as an
 * image that never ends (the server decides everything, this page only shows it and polls how it goes).
 * If the game never sends one, the viewer switches to the screenshots by itself.
 */
export default function ScreenStreamView({ mutex, netid, displayName, onClose, onFallback, onSnapshots }: ScreenStreamViewProps) {
    const startApi = useBackendApi<ApiPlayerScreenStreamStartResp>({ method: 'POST', path: '/player/screenStreamStart' });
    const statusApi = useBackendApi<ApiPlayerScreenStreamStatusResp>({ method: 'POST', path: '/player/screenStreamStatus' });
    const stopApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: '/player/screenStreamStop' });
    const [session, setSession] = useState<Session | null>(null);
    const [step, setStep] = useState<StreamStep>({ kind: 'waiting' });
    const [startError, setStartError] = useState<string | null>(null);
    const [preset, setPreset] = useState<StreamPresetKey>(DEFAULT_PRESET);
    const [imageFailed, setImageFailed] = useState(false);
    const runId = useRef(0);
    const sessionId = useRef<string | null>(null);
    const queryParams = { mutex, netid };

    const tellStopped = () => {
        const id = sessionId.current;
        sessionId.current = null;
        if (id) stopApi({ data: { sessionId: id }, error: () => { } });
    };

    const begin = async (presetKey: StreamPresetKey) => {
        const id = ++runId.current;
        tellStopped();
        setSession(null);
        setStep({ kind: 'waiting' });
        setStartError(null);
        setImageFailed(false);

        const settings = STREAM_PRESETS[presetKey];
        const started = await startApi({
            queryParams,
            data: { fps: settings.fps, width: settings.width, quality: settings.quality },
            timeout: ApiTimeout.LONG,
            error: () => { },
        });
        if (runId.current !== id) {
            //closed or restarted while asking: do not leave a view nobody watches
            if (started && 'sessionId' in started) stopApi({ data: { sessionId: started.sessionId }, error: () => { } });
            return;
        }
        if (!started) return setStartError('Could not reach txAdmin.');
        if ('error' in started) return setStartError(started.error);

        sessionId.current = started.sessionId;
        setSession({ sessionId: started.sessionId, viewToken: started.viewToken });

        let failures = 0;
        while (runId.current === id) {
            await new Promise((resolve) => setTimeout(resolve, STATUS_PERIOD_MS));
            if (runId.current !== id) return;
            const resp = await statusApi({ data: { sessionId: started.sessionId }, error: () => { } });
            if (runId.current !== id) return;

            const next = getStreamStep(resp, failures);
            if (next.kind === 'retry') {
                failures = next.failures;
                continue;
            }
            failures = 0;
            setStep(next);
            if (next.kind === 'ended') {
                sessionId.current = null; //already over on the server
                if (next.fallback) onFallback(next.message);
                return;
            }
        }
    };

    useEffect(() => {
        begin(DEFAULT_PRESET);
        return () => {
            runId.current++;
            tellStopped();
        };
    }, []);

    const handlePreset = (key: StreamPresetKey) => {
        setPreset(key);
        begin(key);
    };

    const ended = step.kind === 'ended' ? step : null;
    const failedToLoad = imageFailed && !ended;
    const canRestart = (ended?.canRestart ?? false) || failedToLoad || (startError !== null);
    const isLive = step.kind === 'live' && !imageFailed;

    return (
        <>
            <p className="text-sm text-muted-foreground">
                The player's game screen, up to {STREAM_PRESETS[preset].fps} images per second. It is not a video and has no sound.
                Your viewing is written to the action log and ends after 10 minutes.
            </p>

            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black" data-testid="screen-frame">
                {session && !ended && !imageFailed ? (
                    <img
                        key={session.sessionId}
                        src={buildStreamImageUrl(session.sessionId, session.viewToken)}
                        alt={`Game screen of ${displayName}`}
                        referrerPolicy="no-referrer"
                        className="size-full object-contain"
                        onError={() => setImageFailed(true)}
                    />
                ) : null}
                {!isLive && !ended && !startError && !imageFailed ? (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2Icon className="size-5 animate-spin" /> Waiting for the player's game...
                    </div>
                ) : null}
                {isLive ? (
                    <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
                        <span className="size-2 rounded-full bg-red-500 animate-pulse" /> LIVE
                        <span className="font-mono font-normal" data-testid="stream-fps">{step.kind === 'live' ? step.fps.toFixed(1) : ''} fps</span>
                    </span>
                ) : null}
            </div>

            {startError || ended || failedToLoad ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm" role="alert">
                    {startError ?? ended?.message ?? 'The image could not be loaded.'}
                </div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Quality
                    <select
                        className="rounded border bg-background px-1.5 py-1 text-sm text-foreground"
                        value={preset}
                        onChange={(e) => handlePreset(e.target.value as StreamPresetKey)}
                        data-testid="stream-preset"
                    >
                        {Object.entries(STREAM_PRESETS).map(([key, p]) => (
                            <option key={key} value={key}>{p.label}</option>
                        ))}
                    </select>
                </label>
                <div className="flex gap-2">
                    {canRestart ? (
                        <Button size="sm" onClick={() => begin(preset)}>
                            <RefreshCwIcon className="mr-1 size-4" /> Start again
                        </Button>
                    ) : null}
                    <Button variant="outline" size="sm" onClick={() => { runId.current++; tellStopped(); onSnapshots(); }}>
                        <ImageIcon className="mr-1 size-4" /> Screenshots
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
                </div>
            </div>
        </>
    );
}
