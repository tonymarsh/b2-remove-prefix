# B2 CDN

A Cloudflare Worker for serving and browsing content in a private Backblaze B2
bucket.

- Serve the content in your B2 bucket for free
- Browse the content in your B2 bucket

## Why?
- Backblaze B2 is cheap file storage
- Downloading from Backblaze B2 is normally $0.01 per GB
- Downloading from Backblaze B2 through Cloudflare's CDN is free
- Private buckets prevent people from downloading from your bucket directly

## Setup
### Install Wrangler
See [Cloudflare's
documentation](https://developers.cloudflare.com/workers/cli-wrangler/install-update)
for more information.

### wrangler.toml
Copy `wrangler.toml.example` to `wrangler.toml` and fill in your own information
into the variables. Refer to [Cloudflare's
documentation](https://developers.cloudflare.com/workers/cli-wrangler/configuration)
for more information.
- `routes` [The domains and subdomains this Worker will listen
  on](https://developers.cloudflare.com/workers/platform/routes). This needs to
  contain at least the domains specified in the `MAIN_DOMAIN` and `DIR_DOMAIN`
  vars below.
- `vars` The following `vars` are required for the Worker to function correctly.
    - `B2ACCESS` [Application key ID from Backblaze
      B2](https://www.backblaze.com/b2/docs/application_keys.html).
    - `B2BUCKET` The name of the [B2
      bucket](https://www.backblaze.com/b2/docs/buckets.html) to use.
    - `MAIN_DOMAIN` The domain from which files will be served. If a request
      comes in for any other domain (except `DIR_DOMAIN`), it will be redirected
      to this domain.
    - `DIR_DOMAIN` The domain to use for directory listings.
- `kv_namespaces` Create a [Workers KV
  namespace](https://developers.cloudflare.com/workers/runtime-apis/kv) and bind
  it to this app with the name `B2CDN`
- `triggers` [B2 authorization tokens only last 24
  hours](https://www.backblaze.com/b2/docs/application_keys.html#usingKeys).
  When triggered by a [cron
  job](https://developers.cloudflare.com/workers/platform/cron-triggers), this
  Worker gets a [new authorization token from the B2
  API](https://www.backblaze.com/b2/docs/b2_authorize_account.html) and stores
  it in Workers KV.

### Secrets
[Secrets](https://developers.cloudflare.com/workers/cli-wrangler/commands#secret)
are like `vars` but... secret. This Worker only needs one secret named
`B2SECRET` which should contain the applicationKey (the secret part) of your
Backblaze B2 application key.

## Protected File Listings
You can use [Cloudflare Access](https://www.cloudflare.com/teams/access/) to
require a login for certain subdomains. Let's say you want to publicly share the
files in your B2 Bucket, but not allow others to list the files in it, you can
set up a separate `DIR_DOMAIN` and [place Cloudflare Access in front of
it](https://developers.cloudflare.com/access/setting-up-access/access-applications/connecting-self-hosted-apps).
[There's a lot of supported identity
providers.](https://developers.cloudflare.com/access/configuring-identity-providers)
You can make it so only a certain IP can access the directory listing, or only
particular Google Accounts.

## To Do
- Implement pagination for enormous folders
- Implement more efficient calls to `b2_list_file_names`

## License
MIT
