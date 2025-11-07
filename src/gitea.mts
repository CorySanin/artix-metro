import ky from 'ky';
import { snooze } from './snooze.mjs';

export type CiStatus = "pending" | "success" | "error" | "failure" | "";

export interface GiteaConfig {
    protocol?: string;
    domain?: string;
    apiPrefix?: string;
    token?: string;
}

export interface Commit {
    sha: string;
}

export interface Status {
    sha: string;
    state: CiStatus;
}

interface Hook {
    active: boolean;
    id: number;
}

export class Gitea {
    private _protocol: string;
    private _domain: string;
    private _apiPrefix: string;
    private _token: string;

    constructor(options: GiteaConfig = {}) {
        this._protocol = options.protocol || 'https';
        this._domain = options.domain || 'gitea.artixlinux.org';
        this._apiPrefix = options.apiPrefix || '/api/v1';
        this._token = options.token || '';
    }

    setToken(token: string | null | undefined) {
        if (token) {
            this._token = token;
        }
    }

    getHomepage() {
        return `${this._protocol}://${this._domain}/`;
    }

    getUrlPrefix() {
        return `${this._protocol}://${this._domain}${this._apiPrefix}`;
    }

    async getRepo(...args: string[]) {
        try {
            let headers: HeadersInit = {};
            if (this._token) {
                headers['Authorization'] = `token ${this._token}`
            }
            const resp = await ky.get(`${this.getUrlPrefix()}/repos/${args.join('/')}`, {
                headers
            });
            return await resp.json();
        }
        catch (err) {
            throw err;
        }
    }

    async getCommits(...args: string[]): Promise<Commit[]> {
        try {
            let headers: HeadersInit = {};
            if (this._token) {
                headers['Authorization'] = `token ${this._token}`
            }
            const resp = await ky.get(`${this.getUrlPrefix()}/repos/${args.join('/')}/commits?limit=10`, {
                headers
            });
            return await resp.json();
        }
        catch (err) {
            throw err;
        }
    }

    async getStatus(...args: string[]): Promise<Status> {
        try {
            let commits = await this.getCommits(...args);
            let headers: HeadersInit = {};
            if (this._token) {
                headers['Authorization'] = `token ${this._token}`
            }
            const resp = await ky.get(`${this.getUrlPrefix()}/repos/${args.join('/')}/commits/${commits[0]?.sha}/status`, {
                headers
            });
            return await resp.json();
        }
        catch (err) {
            throw err;
        }
    }

    async getHooks(...args: string[]): Promise<Hook[]> {
        try {
            let headers: HeadersInit = {};
            if (this._token) {
                headers['Authorization'] = `token ${this._token}`
            }
            const resp = await ky.get(`${this.getUrlPrefix()}/repos/${args.join('/')}/hooks`, {
                headers
            });
            return await resp.json();
        }
        catch (err) {
            throw err;
        }
    }

    async sendTestWebhook(...args: string[]): Promise<void> {
        try {
            let headers: HeadersInit = {};
            if (this._token) {
                headers['Authorization'] = `token ${this._token}`
            }
            const hook = (await this.getHooks(...args)).find(hook => hook.active === true);
            if (!hook) {
                throw new Error('No active webhook found');
            }
            await ky.post(`${this.getUrlPrefix()}/repos/${args.join('/')}/hooks/${hook.id}/tests`, {
                headers
            });
        }
        catch (err) {
            throw err;
        }
    }

    async waitForBuild(lastHash: string, ...args: string[]): Promise<void> {
        let missingStatusCount = 0;
        while (true) {
            let status: Status | null;
            try {
                status = await this.getStatus(...args);
            }
            catch {
                status = null;
            }
            if (!status) {
                await snooze(30000);
                continue;
            }
            if (!status.sha && !status.state) {
                if (++missingStatusCount > 3) {
                    console.log('No build info detected. Sending test webhook...');
                    missingStatusCount = 0;
                    await this.sendTestWebhook(...args);
                }
                await snooze(30000);
            }
            else if (status.sha !== lastHash) {
                if (status.state === 'success') {
                    break;
                }
                else if (status.state === 'failure') {
                    throw new Error(`Build ${status.sha} failed.`);
                }
            }
            await snooze(5000);
        }
    }
}

export default Gitea;
