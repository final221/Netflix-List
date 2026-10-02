// Parent cancellation owns route epochs and request registration. A scan may
// abort its borrowed controller, but cannot mutate the registry or timer owner.
export function createSessionScope({ isTargetPage, AbortController, setTimeout, clearTimeout,
    requestTimeoutMs = 10000 }) {
    let token = 0;
    let active = false;
    const requests = new Set();
    const requestState = new WeakMap();

    function cancelledError() {
        const error = new Error('Target route session cancelled');
        error.code = 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED';
        return error;
    }

    function isCurrent(expectedToken) {
        return expectedToken === token && active && isTargetPage();
    }

    function assertCurrent(expectedToken) {
        if (expectedToken === null || expectedToken === undefined) return;
        if (!isCurrent(expectedToken)) throw cancelledError();
    }

    function finishRequest(request) {
        const state = requestState.get(request);
        if (!state || state.finished) return false;
        state.finished = true;
        clearTimeout(state.timeout?.id);
        state.timeout = null;
        requests.delete(request);
        // Close an unread body too. Aborting a completed request is harmless.
        request.controller.abort();
        return true;
    }

    function abortObsoleteRequests() {
        for (const request of requests.keys()) {
            if (!isCurrent(request.sessionToken)) finishRequest(request);
        }
    }

    function setRequestTimeout(request, delayMs) {
        const state = requestState.get(request);
        if (!state || state.finished) return false;
        clearTimeout(state.timeout?.id);
        const timeout = { id: null };
        state.timeout = timeout;
        timeout.id = setTimeout(() => {
            if (state.finished || state.timeout !== timeout) return;
            state.timeout = null;
            request.controller.abort();
        }, delayMs);
        return true;
    }

    function beginRequest(expectedToken) {
        assertCurrent(expectedToken);
        const request = Object.freeze({ controller: new AbortController(), sessionToken: expectedToken });
        requestState.set(request, { timeout: null, finished: false });
        // Optional unscoped reads retain their existing behavior. Production
        // route reads always carry a token; unscoped callers must finish theirs.
        if (expectedToken !== null && expectedToken !== undefined) requests.add(request);
        setRequestTimeout(request, requestTimeoutMs);
        return request;
    }

    return Object.freeze({
        get token() { return token; },
        begin() {
            token++;
            active = true;
            abortObsoleteRequests();
            return token;
        },
        dispose() {
            token++;
            active = false;
            abortObsoleteRequests();
        },
        isCurrent, assertCurrent, cancelledError,
        isCancelled: error => error?.code === 'LEGACY_MY_LIST_ROUTE_SESSION_CANCELLED',
        beginRequest, setRequestTimeout, finishRequest, abortObsoleteRequests,
        requestCount(expectedToken) {
            if (expectedToken === undefined) return requests.size;
            let count = 0;
            for (const request of requests.keys()) if (request.sessionToken === expectedToken) count++;
            return count;
        }
    });
}
