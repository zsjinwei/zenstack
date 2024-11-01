/* eslint-disable @typescript-eslint/no-explicit-any */
import { serialize } from '@zenstackhq/runtime/browser';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

export type PolicyCrudKind = 'read' | 'create' | 'update' | 'delete';

/**
 * Type for query and mutation errors.
 */
export type QueryError = Error & {
    /**
     * Additional error information.
     */
    info?: unknown;

    /**
     * HTTP status code.
     */
    status?: number;
};

export type FindManyAndCountResult<T> = { data: T; total: number; skip?: number; take?: number };

export interface AccessToken {
    token: string;
    expireAt: number;
}

export interface RefreshToken {
    token: string;
    expireAt: number;
}

export interface AuthToken {
    accessToken: AccessToken;
    refreshToken: RefreshToken;
    sessionId?: string;
}

export interface ApiContext {
    getApiEndpoint: () => string;
    getRpcEndpoint: () => string;

    getAccessToken: () => Promise<string>;
    getRefreshToken: () => Promise<string>;

    getAccessTokenExpireAt: () => Promise<number>;
    getRefreshTokenExpireAt: () => Promise<number>;

    setAccessToken: (token: string) => Promise<void>;
    setRefreshToken: (token: string) => Promise<void>;

    setAccessTokenExpireAt: (expireAt: number | string) => Promise<void>;
    setRefreshTokenExpireAt: (expireAt: number | string) => Promise<void>;

    removeAccessToken: () => Promise<void>;
    removeRefreshToken: () => Promise<void>;

    removeAccessTokenExpireAt: () => Promise<void>;
    removeRefreshTokenExpireAt: () => Promise<void>;

    isAccessTokenValid: () => Promise<boolean>;
    isRefreshTokenValid: () => Promise<boolean>;

    doRefreshToken: () => Promise<AuthToken>;
    doClearToken: () => Promise<void>;

    onLogin?: (authToken: AuthToken) => Promise<void>;
    onLogout?: (reason?: string) => Promise<void>;
    onRefresh?: (authToken: AuthToken) => Promise<void>;

    isLoginEndpoint?: (url: string) => boolean;

    request?: AxiosRequestFn;

    logging?: boolean;
}

export type AxiosRequestFn = <T>(config: AxiosRequestConfig) => Promise<AxiosResponse<T>>;

export async function fetcher<R, C extends boolean>(
    url: string,
    options?: AxiosRequestConfig,
    request?: AxiosRequestFn,
    checkReadBack?: C,
    fetchRawResult?: boolean
): Promise<C extends true ? R | undefined : R> {
    const fetch = request ?? axios.create().request;
    try {
        const res = await fetch<R>({
            ...options,
            url,
        });
        if (fetchRawResult) {
            return res.data as R;
        }
        const resData: any = res.data;
        return resData.data as R;
    } catch (err: any) {
        console.error('fetcher error:', err);
        const errData = err?.response?.data ?? { error: err.message };
        if (
            checkReadBack !== false &&
            errData.error?.prisma &&
            errData.error?.code === 'P2004' &&
            errData.error?.reason === 'RESULT_NOT_READABLE'
        ) {
            // policy doesn't allow mutation result to be read back, just return undefined
            return undefined as any;
        }
        const error: QueryError = new Error('An error occurred while fetching the data.');
        error.info = errData.error;
        error.status = err?.response?.status;
        throw error;
    }
}

type QueryKey = [
    string /* model */,
    string /* operation */,
    unknown /* args */,
    {
        infinite: boolean;
        optimisticUpdate: boolean;
    } /* flags */
];

/**
 * Computes query key for the given model, operation and query args.
 * @param model Model name.
 * @param urlOrOperation Prisma operation (e.g, `findMany`) or request URL. If it's a URL, the last path segment will be used as the operation name.
 * @param args Prisma query arguments.
 * @param options Query options, including `infinite` indicating if it's an infinite query (defaults to false), and `optimisticUpdate` indicating if optimistic updates are enabled (defaults to true).
 * @returns Query key
 */
export function getQueryKey(
    model: string,
    urlOrOperation: string,
    args: unknown,
    options: { infinite: boolean; optimisticUpdate: boolean } = { infinite: false, optimisticUpdate: true }
): QueryKey {
    if (!urlOrOperation) {
        throw new Error('Invalid urlOrOperation');
    }
    const operation = urlOrOperation.split('/').pop();

    const { infinite } = options;
    // infinite query doesn't support optimistic updates
    const optimisticUpdate = options.infinite ? false : options.optimisticUpdate;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return [model, operation!, args, { infinite, optimisticUpdate }];
}

export function makeUrl(url: string, args: unknown) {
    if (!args) {
        return url;
    }

    const { data, meta } = serialize(args);
    let result = `${url}?q=${encodeURIComponent(JSON.stringify(data))}`;
    if (meta) {
        result += `&meta=${encodeURIComponent(JSON.stringify({ serialization: meta }))}`;
    }
    return result;
}
