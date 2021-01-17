import Router from './router'

const CACHE = caches.default
const ERROR_FACES = [
    "¯\_(ツ)_/¯",
    "(⊙_⊙)？",
    "ಥ_ಥ",
    "＼（〇_ｏ）／",
    "¯\(°_o)/¯",
    "╮（╯＿╰）╭",
    "╮(╯▽╰)╭",
    "(⊙_⊙;)",
    "(°ロ°) !",
    "┐('～`;)┌",
    "┐(￣ヘ￣;)┌",
    "( ಠ ʖ̯ ಠ)",
    "ლ(ಠ_ಠ ლ)",
    "ლ(¯ロ¯\"ლ)",
    "┐(￣ヮ￣)┌",
    "(눈_눈)",
    "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧",
    "(ಠ_ಠ)",
    "(￣﹃￣)",
    "(ʘ ͟ʖ ʘ)",
    "( ಥ ʖ̯ ಥ)",
    "( ͡° ʖ̯ ͡°)",
]

const CACHE_AGE_SECONDS = 604800 // 1 week in seconds
const CACHE_ERRORS_SECONDS = 10  // cache errors like 404 for 10 seconds
const PLAIN_TEXT_CONTENT_TYPE = "text/plain;charset=utf-8"

const ERROR_CODES = {
    "400": "Bad Request",
    "401": "Unauthorized",
    "402": "Payment Required",
    "403": "Forbidden",
    "404": "Not Found",
    "405": "Method Not Allowed",
    "406": "Not Acceptable",
    "407": "Proxy Authentication Required",
    "408": "Request Timeout",
    "409": "Conflict",
    "410": "Gone",
    "411": "Length Required",
    "412": "Precondition Required",
    "413": "Request Entry Too Large",
    "414": "Request-URI Too Long",
    "415": "Unsupported Media Type",
    "416": "Requested Range Not Satisfiable",
    "417": "Expectation Failed",
    "500": "Internal Server Error",
    "501": "Not Implemented",
    "502": "Bad Gateway",
    "503": "Service Unavailable",
    "504": "Gateway Timeout",
    "505": "HTTP Version Not Supported",
}


addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})


async function addSecurityHeaders(response) {
    let contentType = response.headers.get("Content-Type")

    // if HTML content
    if(/text\/html/i.test(contentType)) {
        response.headers.set("Content-Security-Policy", `default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'`)
        response.headers.set("Permissions-Policy", `geolocation=(),microphone=()`)
        response.headers.set("Referrer-Policy", "no-referrer-when-downgrade")
        response.headers.set("X-Frame-Options", "SAMEORIGIN")
    }
    else {
        response.headers.set("Access-Control-Allow-Origin", '*');
    }
}


async function getB2File(request) {
    const downloadAuth = await B2CDN.get("downloadAuth")
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
            "Authorization": downloadAuth,
        }
    })
    
    if(response.ok) {
        return modifiedB2Response(request, response)
    }
    else {
        return rewriteErrorResponse(request, response)
    }
}


async function modifiedB2Response(request, response) {
    console.log("modifiedB2Response...")
    const newResponse = new Response(response.body, response)

    // cache for a week
    newResponse.headers.set("Cache-Control", `public, immutable, max-age=${CACHE_AGE_SECONDS}`)
    newResponse.headers.set("Expires", new Date(Date.now() + CACHE_AGE_SECONDS * 1000).toUTCString())

    convertB2Headers(request, newResponse)

    return newResponse
}


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


async function rewriteErrorResponse(request, response) {
    console.log("rewriteErrorResponse...")
    console.log("Original error response:")
    console.log(response)

    // pick a random face from our ERROR_FACES array at the top
    const randomIdx = Math.floor(Math.random() * ERROR_FACES.length)
    const randomFace = ERROR_FACES[randomIdx]
    const statusText = ERROR_CODES[response.status]
    let responseBody = `${statusText}\n${randomFace}`

    const newResponse = new Response(responseBody, {
        status: response.status,
        statusText: statusText,
        headers: {
            "Cache-Control": `public, immutable, max-age=${CACHE_ERRORS_SECONDS}`,
            "Content-Type": PLAIN_TEXT_CONTENT_TYPE,
        }
    })

    // CACHE.put(request.clone(), newResponse.clone())

    console.log("Returning newResponse!")
    return newResponse
}


async function handleRequest(request) {
    const cachedResponse = await CACHE.match(request.clone())
    if(cachedResponse !== undefined) {
        return cachedResponse
    }
    const r = new Router()
    // Replace with the appropriate paths and handlers
    // r.get('.*/bar', () => new Response('responding for /bar'))
    // r.get('.*/foo', request => handler(request))
    // r.post('.*/foo.*', request => handler(request))
    // r.get('/demos/router/foo', request => fetch(request)) // return the response from the origin
    // r.get('/', () => new Response(":)")) // return a default message for the root route
    // r.get('/robots\\.txt', request => getRobotsTxt(request))
    r.get("/faces(\\.txt)?", () => new Response(`${ERROR_FACES.join(" \n")}`, {
        headers: {"Content-Type": PLAIN_TEXT_CONTENT_TYPE}
    }))
    r.get('.*', request => getB2File(request))


    const response = await r.route(request)
    addSecurityHeaders(response)
    console.log("ABOUT TO CACHE REQUEST:")
    CACHE.put(request.clone(), response.clone())
    return response
}
