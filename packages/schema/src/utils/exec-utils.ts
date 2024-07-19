import { execSync as _exec, exec, ExecSyncOptions, spawn } from 'child_process';

/**
 * Utility for executing command synchronously and prints outputs on current console
 */
export function execSync(cmd: string, options?: Omit<ExecSyncOptions, 'env'> & { env?: Record<string, string> }): void {
    const { env, ...restOptions } = options ?? {};
    const mergedEnv = env ? { ...process.env, ...env } : undefined;
    _exec(cmd, { encoding: 'utf-8', stdio: options?.stdio ?? 'inherit', env: mergedEnv, ...restOptions });
}

/**
 * Utility for running package commands through npx/bunx
 */
export function execPackage(
    cmd: string,
    options?: Omit<ExecSyncOptions, 'env'> & { env?: Record<string, string>; prefix?: string }
): void {
    const packageManager = process?.versions?.bun ? 'bunx' : 'npx';
    execSync(`${packageManager}${options?.prefix ? ' --prefix ' + options.prefix : ''} ${cmd}`, options);
}

export async function execAsync(
    cmd: string,
    options?: Omit<ExecSyncOptions, 'env'> & { env?: Record<string, string> }
) {
    const { env, ...restOptions } = options ?? {};
    const mergedEnv = env ? { ...process.env, ...env } : undefined;
    await exec(cmd, { encoding: 'utf-8', stdio: options?.stdio ?? 'inherit', env: mergedEnv, ...restOptions });
}

export async function execPackageAsync(
    cmd: string,
    options?: Omit<ExecSyncOptions, 'env'> & { env?: Record<string, string>; prefix?: string }
) {
    return new Promise((resolve, reject) => {
        const packageManager = process?.versions?.bun ? 'bunx' : 'npx';
        // await execAsync(`${packageManager}${options?.prefix ? ' --prefix ' + options.prefix : ''} ${cmd}`, options);
        const childProcess = spawn(packageManager, cmd.split(' '), { stdio: 'ignore' });
        // childProcess.stdin.end();
        childProcess.on('exit', (code) => {
            if (code === 0) {
                resolve(code);
            } else {
                reject(new Error(`Command failed with code ${code}`));
            }
        });

        // childProcess.stderr.on('data', (data) => {
        //     console.error(data.toString());
        // });
    });
}
