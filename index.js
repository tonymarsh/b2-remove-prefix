import Router from './router'
import handleAuthCronJob from './authorization'
import {getFacesPage, rewriteErrorResponse} from './error_handling'
import getB2Directory from './directory'
import {
    B2_LIST_FILE_NAMES_ENDPOINT,
    CACHE_AGE_SECONDS,
    PLAIN_TEXT_CONTENT_TYPE,
} from './constants'

const CACHE = caches.default


// entrypoint
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event))
})


/**
 * Add extra security headers to get an A on https://securityheaders.com/
 *
 * @param response a Response object that will be modified in-place
 */
function addSecurityHeaders(response) {
    let contentType = response.headers.get("Content-Type")

    // if HTML content
    if(/text\/html/i.test(contentType)) {
        // "unsafe-inline" for style-src doesn't seem like that big a deal
        // but it will prevent you from getting an A+ on https://securityheaders.com/
        // response.headers.set("Content-Security-Policy", `default-src 'self'; style-src 'unsafe-inline' 'self' https://cdnjs.cloudflare.com; frame-ancestors 'self'`)
        // forbid geolocation and microphone usage by this page or any iframes on it
        response.headers.set("Permissions-Policy", `geolocation=(),microphone=()`)
        response.headers.set("Referrer-Policy", "no-referrer-when-downgrade")
        response.headers.set("X-Frame-Options", "SAMEORIGIN")
    }
    else {
        // allow hotlinking of font files and other assets
        response.headers.set("Access-Control-Allow-Origin", '*');
    }
}


/**
 * Fetch and return a file from Backblaze B2 by supplying the download authorization
 * token in the Authorization header.
 * Errors are rewritten to not give away that this is a B2 bucket.
 * Headers starting with "x-bz" are removed before being returned to the user.
 * Adds cache and security-related headers.
 *
 * @param request the request from a client that will be rewritten to fetch from
 *                a Backblaze B2 bucket
 * @returns {Promise<Response>} the Response to the client that will either be
 *                              the requested file or an error page
 */
async function getB2File(request) {
    const authToken = await B2CDN.get("authToken")
    // const downloadAuth = await B2CDN.get("downloadAuth")
    const downloadUrl = await B2CDN.get("downloadUrl")

    let requestedUrl = new URL(request.url)
    console.log(`requestedUrl = ${requestedUrl.toString()}`)
    let url = new URL(downloadUrl)
    url.pathname = `/file/${B2BUCKET}/${requestedUrl.pathname}`

    const response = await fetch(url.toString(), {
        cf: {
            cacheTtl: 60,
            cacheEverything: true,
        },
        headers: {
            // "Authorization": downloadAuth,
            "Authorization": authToken,
        }
    })
    
    if(response.ok) {
        return modifiedB2Response(request, response)
    }
    else {
        return rewriteErrorResponse(request, response)
    }
}


/**
 * Adds cache headers, converts some Backblaze B2-specific headers to standard
 * headers, and deletes the headers that start with "x-bz"
 *
 * @param request a request for a file on B2
 * @param response the successful response from B2 that will be copied and modified
 * @param convertHeaders if true, convert x-bz headers to standard headers then delete them
 * @returns {Promise<Response>} the modified response
 */
async function modifiedB2Response(request, response, convertHeaders=true) {
    console.log("modifiedB2Response...")
    const newResponse = new Response(response.body, response)

    // cache for a week
    newResponse.headers.set("Cache-Control", `public, immutable, max-age=${CACHE_AGE_SECONDS}`)
    newResponse.headers.set("Expires", new Date(Date.now() + CACHE_AGE_SECONDS * 1000).toUTCString())
    if(convertHeaders) {
        convertB2Headers(request, newResponse)
    }

    return newResponse
}


/**
 * Converts the x-bz-content-sha1 header to an ETag header.
 * Converts the x-bz-upload-timestamp header to a Last-Modified header.
 * By default also deletes all headers that start with "x-bz"
 *
 * @param request the request from the client for a B2 file
 * @param response the response from B2 that will be modified in-place
 * @param deleteHeaders if true, delete the x-bz headers in the response
 */
function convertB2Headers(request, response, deleteHeaders=true) {
    console.log("convertB2Headers...")
    // get a Last-Modified header from x-bz-upload-timestamp
    let bzts = response.headers.get("x-bz-upload-timestamp")
    bzts = parseInt(bzts)
    let d = new Date(bzts)
    let lastModified = d.toUTCString()
    response.headers.set("Last-Modified", lastModified)

    // get an ETag header from x-bz-content-sha1
    let bzsha = response.headers.get("x-bz-content-sha1")
    bzsha = bzsha.replace(/^unverified:/, "")  // in case it was uploaded without a checksum
    bzsha = bzsha.substring(0, 16)  // just get the first 16 characters of it
    bzsha = `"${bzsha}"`  // CloudFlare wants the ETag wrapped in quotes
    response.headers.set("ETag", bzsha)

    if(deleteHeaders) {
        // remove the 'x-bz-' Backblaze headers
        for(const header of response.headers.keys()) {
            if(header.match(/^x-bz/i)) {
                response.headers.delete(header)
            }
        }
    }

    // these file extensions we want to show up as plain text
    let url = new URL(request.url)
    if(/\.(pub|boot|cfg)$/.test(url.pathname)) {
        response.headers.set("Content-Type", PLAIN_TEXT_CONTENT_TYPE)
    }
}


/**
 * Handle an incoming user request.
 *
 * @param event the fetch event that triggered this listener
 * @returns {Promise<*>} a response either from Backblaze B2 or an error message
 */
async function handleRequest(event) {
    const request = event.request

    // return from cache if we've seen this before and the response isn't stale
    // const cachedResponse = await CACHE.match(request.clone())
    // if(cachedResponse !== undefined) {
    //     return cachedResponse
    // }

    const r = new Router()
    // Replace with the appropriate paths and handlers
    // r.get('.*/bar', () => new Response('responding for /bar'))
    // r.get('.*/foo', request => handler(request))

    // display the possible error message faces when a user visits /faces or /faces.txt
    r.get("/faces(\\.txt)?", getFacesPage)
    r.get('.*/', request => getB2Directory(request))
    // catch-all route to return a Backblaze B2 file (should be last router rule)
    r.get('.*', request => getB2File(request))

    // evaluate this request and get the response from the matching route handler
    const response = await r.route(request)
    addSecurityHeaders(response)

    // put this response in the cache in the background (the Worker will stay alive to finish the job)
    event.waitUntil(CACHE.put(request.clone(), response.clone()));

    return response
}


// entrypoint for Cron Trigger
addEventListener("scheduled", event => {
    event.waitUntil(handleAuthCronJob(event))
})
