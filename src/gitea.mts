import ky from 'ky';
import { snooze } from './snooze.mjs';

type CiStatus = "pending" | "success" | "error" | "failure";

interface GiteaConfig {
    protocol?: string;
    domain?: string;
    apiPrefix?: string;
    token?: string;
}

interface Commit {
    sha: string;
}

interface Status {
    sha: string;
    state: CiStatus
}

class Gitea {
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

    async waitForBuild(lastHash: string, ...args: string[]): Promise<void> {
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
            if (status.sha !== lastHash) {
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
export { Gitea };
export type { GiteaConfig, Commit, Status, CiStatus };
