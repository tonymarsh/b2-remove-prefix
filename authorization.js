/**
 * This part of the Worker is intended to be run by using Cloudflare Cron Triggers to obtain a
 * an authorization token so that files in a private B2 bucket can be listed and downloaded
 * only through an authorized worker.
 *
 * This Worker will use a Backblaze B2 keyID and applicationKey (secret) to
 *     1. Obtain an authorization token
 *     2. Store the authorization token in Workers KV for later use
 *
 * SETTINGS
 * This app expects you to have the following `vars` present in your wrangler.toml:
 *     - B2ACCESS = the keyID to use (i.e. 000c12345a1234b0000000001)
 *     - B2BUCKET = the name of the bucket to obtain a token for
 *
 * SECRETS
 * This app also expects the following `secrets` to be accessible to your app.
 * DO NOT ADD SECRETS TO THE `vars` SECTION OF YOUR wrangler.toml FILE!
 *     - B2SECRET = the applicationKey to use (i.e. K000FGH1C9+/daQyVa4qx+B/catguYM)
 *
 * To create a secret, run the command `wrangler secret put <secret_name>`
 * Learn more here:
 * https://developers.cloudflare.com/workers/cli-wrangler/commands#secret
 *
 * Obtaining authorization tokens is a Class C transaction on Backblaze B2. It's
 * the most expensive tier (still only a fraction of a penny for thousands a
 * day at the time of this writing though). Refreshing your authorization token
 * every 4 hours or so should be plenty frequent, and still well within
 * free-tier limits (2,500 free Class C transactions daily at time of writing).
 */

// B2 API URLs / Endpoints
const B2_AUTHORIZE_URL = "https://api.backblazeb2.com/b2api/v2/b2_authorize_account"
const B2_LIST_BUCKETS_ENDPOINT = "/b2api/v2/b2_list_buckets"
const B2_GET_DOWNLOAD_AUTHORIZATION_ENDPOINT = "/b2api/v2/b2_get_download_authorization"

/**
 * 24 hours in seconds, the max duration of an authorization token's validity
 *
 * @type {number}
 */
const AUTH_TOKEN_MAX_AGE = 86400


/**
 * Obtain authorization token by using our application ID and application key
 */
async function authorizeAccount() {
    // console.log("authorizeAccount...")

    // base-64 encode our B2 App ID and Secret Key
    const b64auth = btoa(`${B2ACCESS}:${B2SECRET}`)

    const response = await fetch(B2_AUTHORIZE_URL, {
        headers: {
            "Authorization": `Basic ${b64auth}`  // prepend "Basic " to our Base64 string in an Authorization header
        },
    })

    return await response.json()
}


/**
 * Use the authorization object returned by authorizeAccount
 * to get the ID of the bucket named in the B2BUCKET variable
 *
 * @param {object} authobj the JSON object returned by a call to authorizeAccount
 */
async function getBucketId(authobj) {
    // console.log("getBucketId...")
    try {
        if (authobj.allowed.bucketId) {
            return authobj.allowed.bucketId
        }
    } catch (err) {
        // console.log("Let's ask for the Bucket ID through the API instead")
    }

    let url = new URL(authobj.apiUrl)
    url.pathname = B2_LIST_BUCKETS_ENDPOINT

    let jsonData = {
        accountId: authobj.accountId,
        bucketName: B2BUCKET,
    }
    let authToken = authobj.authorizationToken

    const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
            "Authorization": authToken,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(jsonData),
    })

    const bucketList = await response.json()

    // console.log(`bucketId = ${bucketList.buckets[0].bucketId}`)
    // console.log(`bucketName = ${bucketList.buckets[0].bucketName}`)
    return bucketList.buckets[0].bucketId
}


/**
 * Get the download authorization token using the authorization
 * token obtained in authorizeAccount. This download
 * authorization token can be used to download from private B2 buckets.
 *
 * @param {object} authobj the JSON response from authorizeAccount
 * @param {string} bucketId the ID of the bucket the token will be good for
 */
async function getDownloadAuthorization(authobj, bucketId) {
    let downloadAuthURL = new URL(authobj.apiUrl)
    downloadAuthURL.pathname = B2_GET_DOWNLOAD_AUTHORIZATION_ENDPOINT
    let jsonData = {
        bucketId: bucketId,
        fileNamePrefix: "",
        validDurationInSeconds: MAX_AGE,
    }

    let authToken = authobj.authorizationToken
    const response = await fetch(downloadAuthURL.toString(), {
        method: "POST",
        headers: {
            "Authorization": authToken,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(jsonData)
    })

    const downloadAuth = await response.json()
    return `${downloadAuth.authorizationToken}`
}


/**
 * Obtains essential information from the Backblaze B2 API (authorization token, Bucket ID, and API/download URLs)
 * and puts it in Workers KV for retrieval by our other Worker that actually does the downloading from the bucket.
 *
 * This worker is intended to be executed by a cron job and does not need a user's HTTP request.
 *
 * @param {FetchEvent|ScheduledEvent} event the fetch event that triggered the Worker
 */
async function handleAuthCronJob(event) {
    // obtain authorization token
    const authobj = await authorizeAccount()

    // obtain the bucket ID
    const bucketId = await getBucketId(authobj).then()

    event.waitUntil(Promise.allSettled([
        B2CDN.put("apiUrl", authobj.apiUrl),
        B2CDN.put("authToken", authobj.authorizationToken, {expirationTtl: AUTH_TOKEN_MAX_AGE}),
        B2CDN.put("downloadUrl", authobj.downloadUrl),
        B2CDN.put("bucketId", bucketId),
    ]))

    return new Response("OK", {
        headers: {'content-type': 'text/plain'},
    })
}

export default handleAuthCronJob
