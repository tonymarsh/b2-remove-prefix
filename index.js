import Router from './router'
import handleAuthCronJob from './authorization'
import {getFacesPage, rewriteErrorResponse} from './error_handling'
import getB2Directory from './directory'
import getB2File from './file_download'

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
        response.headers.set("Content-Security-Policy", `default-src 'self'; frame-ancestors 'self'`)
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
 * Handle an incoming user request.
 *
 * @param event the fetch event that triggered this listener
 * @returns {Promise<*>} a response either from Backblaze B2 or an error message
 */
async function handleRequest(event) {
    const request = event.request

    // return from cache if we've seen this before and the response isn't stale
    const cachedResponse = await CACHE.match(request.clone())
    if(cachedResponse !== undefined) {
        return cachedResponse
    }

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
