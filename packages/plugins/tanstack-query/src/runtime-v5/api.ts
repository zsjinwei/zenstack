/* eslint-disable @typescript-eslint/no-explicit-any */
import { ComputedRef, MaybeRefOrGetter, toValue } from 'vue';
import { fetcher, getQueryKey, makeUrl, marshal, type FetchFn } from '../runtime/common';

export function apiModelQuery<TQueryFnData>(
    model: string,
    url: string,
    args?: MaybeRefOrGetter<unknown> | ComputedRef<unknown>,
    fetch?: FetchFn,
    rawResult = false
) {
    const queryKey = getQueryKey(model, url, args, {
        infinite: false,
        optimisticUpdate: false,
    });

    const [_prefix, _model, _op, queryArgs] = queryKey;
    const reqUrl = makeUrl(url, toValue(queryArgs));
    return fetcher<TQueryFnData, false>(reqUrl, undefined, fetch, false, rawResult === true);
}

export function apiModelMutation<R = any, C extends boolean = boolean, Result = C extends true ? R | undefined : R>(
    model: string,
    method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    data?: any,
    fetch?: FetchFn,
    checkReadBack?: C,
    rawResult = false
) {
    const reqUrl = method === 'DELETE' ? makeUrl(url, data) : url;
    const fetchInit: RequestInit = {
        method,
        ...(method !== 'DELETE' && {
            headers: {
                'content-type': 'application/json',
            },
            body: marshal(data),
        }),
    };
    return fetcher<R, C>(reqUrl, fetchInit, fetch, checkReadBack, rawResult === true) as Promise<Result>;
}
