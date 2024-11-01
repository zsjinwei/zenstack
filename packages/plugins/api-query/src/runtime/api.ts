/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosRequestConfig } from 'axios';
import { AxiosRequestFn, fetcher, getQueryKey, makeUrl } from './common';

export function apiModelQuery<TQueryFnData>(
    model: string,
    url: string,
    args?: unknown,
    fetch?: AxiosRequestFn,
    fetchRawResult?: boolean
) {
    const queryKey = getQueryKey(model, url, args, {
        infinite: false,
        optimisticUpdate: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_model, _op, queryArgs] = queryKey;
    const reqUrl = makeUrl(url, queryArgs);
    return fetcher<TQueryFnData, false>(reqUrl, undefined, fetch, false, fetchRawResult === true);
}

export function apiModelMutation<R = any, C extends boolean = boolean, Result = C extends true ? R | undefined : R>(
    model: string,
    method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    data?: any,
    fetch?: AxiosRequestFn,
    checkReadBack?: C,
    fetchRawResult?: boolean
) {
    const reqUrl = method === 'DELETE' ? makeUrl(url, data) : url;
    const fetchOptions: AxiosRequestConfig = {
        url: reqUrl,
        method,
        data,
    };
    return fetcher<R, C>(reqUrl, fetchOptions, fetch, checkReadBack, fetchRawResult === true) as Promise<Result>;
}
