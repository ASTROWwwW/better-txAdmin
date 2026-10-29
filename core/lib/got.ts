import { txEnv, txHostConfig } from '@core/globalData';
import got from 'got';
import { isIPv4 } from 'node:net';

export default got.extend({
    timeout: {
        request: 5000
    },
    headers: {
        'User-Agent': `txAdmin ${txEnv.txaVersion}`,
    },
    //Binding to an ipv6 address would make every request to an ipv4 host fail (EAFNOSUPPORT)
    localAddress: txHostConfig.netInterface && isIPv4(txHostConfig.netInterface)
        ? txHostConfig.netInterface
        : undefined,
});
