import { formatHostPort } from '@lib/host/isIpAddressLocal';

type EndpointsOptions = {
    netInterface?: string;
    fxsPort?: number;
    sourceName?: string;
};

/**
 * Builds the endpoint_add_tcp/udp lines for the server.cfg, honoring the interface and port forced by the host config.
 */
export const buildServerEndpoints = ({ netInterface, fxsPort, sourceName }: EndpointsOptions) => {
    if (!netInterface && !fxsPort) {
        return [
            'endpoint_add_tcp "0.0.0.0:30120"',
            'endpoint_add_udp "0.0.0.0:30120"',
        ].join('\n');
    }

    const comment = `# ${sourceName}: do not modify!`;
    const endpoint = formatHostPort(netInterface ?? '0.0.0.0', fxsPort ?? 30120);
    return [
        `endpoint_add_tcp "${endpoint}" ${comment}`,
        `endpoint_add_udp "${endpoint}" ${comment}`,
    ].join('\n');
};
