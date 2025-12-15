import ky from 'ky';

export interface GitlabConfig {
    protocol?: string;
    domain?: string;
    apiPrefix?: string;
    token?: string;
}

export interface Commit {
    id: string;
    short_id: string;
    created_at: string;
    parent_ids: string[];
}

export interface Tag {
    name: string;
    message: string;
    target: string;
    commit: Commit;
    protected: boolean;
}

export class Gitlab {
    private _protocol: string;
    private _domain: string;
    private _apiPrefix: string;
    private _token: string;

    constructor(options: GitlabConfig = {}) {
        this._protocol = options.protocol || 'https';
        this._domain = options.domain || 'gitlab.archlinux.org';
        this._apiPrefix = options.apiPrefix || '/api/v4';
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

    async getTags(repoPath: string) {
        try {
            const headers: HeadersInit = {};
            if (this._token) {
                headers['Authorization'] = `token ${this._token}`
            }
            const resp = await ky.get<Tag[]>(`${this.getUrlPrefix()}/projects/${encodeURIComponent(repoPath)}/repository/tags`, {
                headers
            });
            return await resp.json();
        }
        catch (err) {
            throw err;
        }
    }

    getPackageTags(pkgBase: string) {
        return this.getTags(`archlinux/packaging/packages/${pkgBase}`);
    }
}

export default Gitlab;
