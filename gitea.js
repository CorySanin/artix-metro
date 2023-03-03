const p = require('phin');

// how is there no decent library for this shit?
class Gitea {
    constructor(options = {}) {
        this._protocol = options._protocol || 'https';
        this._domain = options.domain || 'gitea.artixlinux.org';
        this._apiPrefix = options.apiPrefix || '/api/v1';
        this._token = options.token || null;
    }

    getHomepage() {
        return `${this._protocol}://${this._domain}/`;
    }

    getUrlPrefix() {
        return `${this._protocol}://${this._domain}${this._apiPrefix}`;
    }

    getRepo(...args) {
        return new Promise(async (resolve, reject) => {
            try {
                let headers = {};
                if (this._token) {
                    headers.Authorization = `token ${this._token}`
                }
                let resp = await p({
                    url: `${this.getUrlPrefix()}/repos/${args.join('/')}`,
                    headers,
                    method: 'GET',
                    parse: 'json',
                });
                resolve(resp.body);
            }
            catch (err) {
                reject(err);
            }
        });
    }

    getCommits(...args) {
        return new Promise(async (resolve, reject) => {
            try {
                let headers = {};
                if (this._token) {
                    headers.Authorization = `token ${this._token}`
                }
                let resp = await p({
                    url: `${this.getUrlPrefix()}/repos/${args.join('/')}/commits?limit=10`,
                    headers,
                    method: 'GET',
                    parse: 'json',
                });
                resolve(resp.body);
            }
            catch (err) {
                reject(err);
            }
        });
    }

    getStatus(...args) {
        return new Promise(async (resolve, reject) => {
            try {
                let commits = await this.getCommits(...args);
                let headers = {};
                if (this._token) {
                    headers.Authorization = `token ${this._token}`
                }
                let resp = await p({
                    url: `${this.getUrlPrefix()}/repos/${args.join('/')}/commits/${commits[0].sha}/status`,
                    headers,
                    method: 'GET',
                    parse: 'json',
                });
                resolve(resp.body);
            }
            catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = Gitea;