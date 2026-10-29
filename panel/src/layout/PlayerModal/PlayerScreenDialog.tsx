import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ScreenStreamView from './ScreenStreamView';
import ScreenSnapshotView from './ScreenSnapshotView';

type PlayerScreenDialogProps = {
    mutex: string;
    netid: number;
    displayName: string;
    onClose: () => void;
};

/**
 * Shows the game screen of a player: a smooth live view when the player's game can send it, the screenshots
 * otherwise. The live view image is a web page feature (the in-game menu has no way to authenticate it), so
 * the in-game menu uses the screenshots.
 */
export default function PlayerScreenDialog({ mutex, netid, displayName, onClose }: PlayerScreenDialogProps) {
    const [mode, setMode] = useState<'stream' | 'snapshots'>(window.txConsts.isWebInterface ? 'stream' : 'snapshots');
    const [notice, setNotice] = useState<string | undefined>();

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-3xl gap-3">
                <DialogHeader>
                    <DialogTitle>
                        <span className="text-success-inline font-mono mr-2">[{netid}]</span>
                        {displayName}
                    </DialogTitle>
                    <DialogDescription className="sr-only">Live view of the game screen of {displayName}</DialogDescription>
                </DialogHeader>

                {mode === 'stream' ? (
                    <ScreenStreamView
                        mutex={mutex}
                        netid={netid}
                        displayName={displayName}
                        onClose={onClose}
                        onFallback={(why) => { setNotice(why); setMode('snapshots'); }}
                        onSnapshots={() => { setNotice(undefined); setMode('snapshots'); }}
                    />
                ) : (
                    <ScreenSnapshotView
                        mutex={mutex}
                        netid={netid}
                        displayName={displayName}
                        notice={notice}
                        onClose={onClose}
                        onTryLive={() => { setNotice(undefined); setMode(window.txConsts.isWebInterface ? 'stream' : 'snapshots'); }}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
