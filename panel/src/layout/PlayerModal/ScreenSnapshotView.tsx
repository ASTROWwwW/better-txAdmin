import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2Icon, PauseIcon, PlayIcon, RadioIcon, RefreshCwIcon } from 'lucide-react';
import { ApiTimeout, useBackendApi } from '@/hooks/fetch';
import type { GenericApiOkResp } from '@shared/genericApiTypes';
import type { ApiPlayerScreenshotResp } from '@shared/playerApiTypes';
import { getNextStep } from './screenLoop';

type ScreenSnapshotViewProps = {
    mutex: string;
    netid: number;
    displayName: string;
    notice?: string; //why the viewer is on screenshots (the live view could not start)
    onClose: () => void;
    onTryLive: () => void;
};

type Status = 'live' | 'paused' | 'expired' | 'stopped';


/**
 * The fallback of the live view: the game screen of a player, one screenshot after another (about every 1.5s)
 * made by the `screenshot-basic` resource. Each screenshot is taken by the player's game client when txAdmin
 * asks, so the viewer only asks while it is open and playing. Closing it, or pausing, tells txAdmin it is over.
 */
export default function ScreenSnapshotView({ mutex, netid, displayName, notice, onClose, onTryLive }: ScreenSnapshotViewProps) {
    const screenshotApi = useBackendApi<ApiPlayerScreenshotResp>({ method: 'POST', path: '/player/screenshot' });
    const stopApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: '/player/screenshotStop' });
    const [image, setImage] = useState<string | null>(null);
    const [frames, setFrames] = useState(0);
    const [status, setStatus] = useState<Status>('live');
    const [message, setMessage] = useState<string | null>(null);
    const runId = useRef(0);
    const framesRef = useRef(0);
    const queryParams = { mutex, netid };

    const stopLoop = () => {
        runId.current++;
    };

    const tellStopped = () => {
        if (framesRef.current === 0) return;
        stopApi({ queryParams, error: () => { } });
    };

    const start = async (renew: boolean) => {
        const id = ++runId.current;
        setStatus('live');
        setMessage(null);
        let failures = 0;
        let isFirst = true;

        while (runId.current === id) {
            const startedAt = Date.now();
            const resp = await screenshotApi({
                queryParams,
                data: { renew: renew && isFirst },
                timeout: ApiTimeout.LONG,
                error: () => { }, //a network problem comes back as undefined, handled below
            });
            if (runId.current !== id) return;
            isFirst = false;

            const step = getNextStep(
                resp ?? { error: 'Could not reach txAdmin.', code: 'timeout' },
                Date.now() - startedAt,
                failures,
            );
            if (step.kind === 'frame') {
                failures = 0;
                setImage((resp as { image: string }).image);
                framesRef.current++;
                setFrames(framesRef.current);
                setMessage(null);
            } else if (step.kind === 'retry') {
                failures = step.failures;
            } else if (step.kind === 'expired') {
                setStatus('expired');
                setMessage(step.message);
                return;
            } else {
                setStatus('stopped');
                setMessage(step.message);
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, step.waitMs));
        }
    };

    useEffect(() => {
        start(false);
        return () => {
            stopLoop();
            tellStopped();
        };
    }, []);

    const handlePause = () => {
        stopLoop();
        tellStopped();
        setStatus('paused');
    };

    const isMissingResource = message?.includes('screenshot-basic');

    return (
        <>
            <p className="text-sm text-muted-foreground">
                A screenshot of the player's game about every 1.5 seconds, not a video.
                Your viewing is written to the action log, and it ends after 10 minutes unless you keep watching.
            </p>
            {notice ? (
                <div className="rounded-md border bg-secondary/40 p-2 text-sm" role="status">{notice}</div>
            ) : null}

            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black" data-testid="screen-frame">
                {image ? (
                    <img
                        src={image}
                        alt={`Game screen of ${displayName}`}
                        referrerPolicy="no-referrer"
                        className="size-full object-contain"
                    />
                ) : status === 'live' ? (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2Icon className="size-5 animate-spin" /> Waiting for the first screenshot...
                    </div>
                ) : null}
                {status === 'live' && image ? (
                    <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
                        <span className="size-2 rounded-full bg-red-500 animate-pulse" /> SNAPSHOTS
                    </span>
                ) : null}
                {status === 'paused' ? (
                    <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">PAUSED</span>
                ) : null}
            </div>

            {message ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm" role="alert">
                    <p>{message}</p>
                    {isMissingResource ? (
                        <p className="mt-1 text-muted-foreground">
                            Install the <code>screenshot-basic</code> resource on your server and add{' '}
                            <code>ensure screenshot-basic</code> to your <code>server.cfg</code>.
                        </p>
                    ) : null}
                </div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{frames} screenshots received</span>
                <div className="flex gap-2">
                    {window.txConsts.isWebInterface ? (
                        <Button variant="outline" size="sm" onClick={() => { stopLoop(); tellStopped(); onTryLive(); }}>
                            <RadioIcon className="mr-1 size-4" /> Try live view
                        </Button>
                    ) : null}
                    {status === 'live' ? (
                        <Button variant="outline" size="sm" onClick={handlePause}>
                            <PauseIcon className="mr-1 size-4" /> Pause
                        </Button>
                    ) : null}
                    {status === 'paused' ? (
                        <Button variant="outline" size="sm" onClick={() => start(false)}>
                            <PlayIcon className="mr-1 size-4" /> Resume
                        </Button>
                    ) : null}
                    {status === 'expired' ? (
                        <Button size="sm" onClick={() => start(true)}>
                            <RefreshCwIcon className="mr-1 size-4" /> Keep watching
                        </Button>
                    ) : null}
                    <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
                </div>
            </div>
        </>
    );
}
