import Router from './router'

const CACHE = caches.default
const ERROR_FACES = [
    "¯\\_(ツ)_/¯",
    "(⊙_⊙)？",
    "ಥ_ಥ",
    "＼（〇_ｏ）／",
    "¯\\(°_o)/¯",
    "╮（╯＿╰）╭",
    "╮(╯▽╰)╭",
    "(⊙_⊙;)",
    "(°ロ°) !",
    "┐('～`;)┌",
    "┐(￣ヘ￣;)┌",
    "( ಠ ʖ̯ ಠ)",
    "ლ(ಠ_ಠ ლ)",
    `ლ(¯ロ¯"ლ)`,
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
const CACHE_DIR_SECONDS = 30  // cache a directory listing for 10 seconds
const PLAIN_TEXT_CONTENT_TYPE = "text/plain;charset=utf-8"
const HTML_CONTENT_TYPE = "text/html;charset=utf-8"

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

const B2_LIST_FILE_NAMES_ENDPOINT = "/b2api/v2/b2_list_file_names"

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

async function getB2Directory(request) {
    console.log("getB2Directory...")
    const apiUrl = await B2CDN.get("apiUrl")
    const authToken = await B2CDN.get("authToken")
    const bucketId = await B2CDN.get("bucketId")

    const url = new URL(apiUrl)
    url.pathname = B2_LIST_FILE_NAMES_ENDPOINT
    const requestedUrl = new URL(request.url)
    console.log(`requestedUrl.pathname = ${requestedUrl.pathname}`)
    const prefix = requestedUrl.pathname.substring(1)  // chop off first / character
    console.log(`prefix = ${prefix}`)

    const requestBody = {
        bucketId: bucketId,
        maxFileCount: 10000,
        prefix: prefix,
        delimiter: "/"
    }

    const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
            "Authorization": authToken,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody)
    })

    if(!response.ok) {
        return rewriteErrorResponse(request, response)
    }
    const htmlResponse = await convertListFileNamesToHTML(request, response)

    htmlResponse.headers.set("Cache-Control", `public, immutable, max-age=${CACHE_DIR_SECONDS}`)
    htmlResponse.headers.set("Expires", new Date(Date.now() + CACHE_DIR_SECONDS * 1000).toUTCString())
    // return new Response(response.body, response)
    return htmlResponse
}


async function convertListFileNamesToHTML(request, response) {
    console.log("convertListFileNamesToHTML...")
    const respJson = await response.json()
    const requestUrl = new URL(request.url)
    const fullPath = requestUrl.pathname.substring(1)
    let currentDir = requestUrl.pathname.substring(1).match(/([^/]+)\/$/)
    if(currentDir) {
        currentDir = currentDir[1]
    }
    else {
        currentDir = "/"
    }
    const prefixLength = fullPath.length

    let listings = ''
    if(prefixLength > 0) {
        listings = HTML_LINE_ITEM("..", "Up a Level", "", "")
    }

    const folders = []
    const files = []

    // make sure folders show up first
    for(const file of respJson.files) {
        if(/(^\.bzEmpty|\/\.bzEmpty)$/.test(file.fileName)) {
            // skip .bzEmpty files which are there to help create "folders"
        }
        else if(file.action === "folder") {
            folders.push(file)
        }
        else {
            files.push(file)
        }
    }

    // check if we received zero results. If so, this folder didn't exist
    // so return a 404
    if(!(folders.length || files.length)) {
        let errorResponse = new Response("", {status: 404})
        return rewriteErrorResponse(request, errorResponse)
    }

    for(const fldr of folders) {
        listings += convertFileInfoJsonToHTML(fldr, prefixLength)
    }
    for(const file of files) {
        listings += convertFileInfoJsonToHTML(file, prefixLength)
    }

    let html = FILE_LIST_HTML_TEMPL(currentDir, fullPath, listings)
    const htmlResponse = new Response(html, {
        status: 200,
        statusText: "OK",
        headers: {
            "Content-Type": HTML_CONTENT_TYPE,
        }
    })
    return htmlResponse
}


function convertFileInfoJsonToHTML(file, prefixLength) {
    let basename = file.fileName.substring(prefixLength)
    let dateStr = "", size = ""
    if(file.action !== "folder") {
        let ts = new Date(file.uploadTimestamp)
        // dateStr = `${ts.toDateString()} ${ts.toLocaleTimeString()}`
        dateStr = ts.toUTCString()
        size = file.contentLength
        if(size > 1099511627776) {  // 1 TiB
            size = (size / 1099511627776).toFixed(2)
        }
        else if(size > 1073741824) {  // 1 GiB
            size = (size / 1073741824).toFixed(2)
            size = `${size} GiB`
        }
        else if(size > 1048576) {  // 1 MiB
            size = (size / 1048576).toFixed(1)
            size = `${size} MiB`
        }
        else if(size > 4096) {  // 4 KiB
            size = (size / 1024).toFixed(1)
            size = `${size} KiB`
        }
        else {
            size = `${size} B`
        }
    }

    return HTML_LINE_ITEM(basename, basename, size, dateStr, file.action)
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
 * Rewrite error responses from Backblaze B2 to have fun little faces. This
 * obfuscates the fact that Backblaze B2 is being used and is generally a
 * more succinct error page for end users.
 *
 * @param request the request from the client to B2
 * @param response the response from B2 that will be copied and modified
 * @returns {Promise<Response>} the new response with the fun face
 */
async function rewriteErrorResponse(request, response) {
    console.log("rewriteErrorResponse...")
    console.log("Original error response:")
    console.log(response)

    // pick a random face from our ERROR_FACES array
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

    return newResponse
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
    r.get("/faces(\\.txt)?", () => new Response(`${ERROR_FACES.join(" \n")}`, {
        headers: {"Content-Type": PLAIN_TEXT_CONTENT_TYPE}
    }))
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

const FILE_LIST_HTML_TEMPL = (currentDir, fullPath, listings) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>${currentDir}</title>

    <link rel="stylesheet" href="/s/css/bootstrap.min.css" 
      integrity="sha256-93wNFzm2GO3EoByj9rKZCwGjAJAwr0nujPaOgwUt8ZQ=" />
    <link rel="stylesheet" href="/s/css/bootstrap-icons.css" 
      integrity="sha256-nS+REWFoREFivmnkcigvxgM4EiLgajX3X8C5z0CqGkE=" />
  </head>
  <body class="bg-light">
    <div class="container">
  <div class="py-5 text-center">
    <h2>Directory Listing of ${currentDir}</h2>
    <p class="lead">${fullPath}</p>
  </div>

  <div class="row">
    <div class="col-md-12">
      <table class="table">
        <thead class="thead-light">
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Size</th>
            <th scope="col">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          ${listings}
        </tbody>
      </table>
    </div>
  </div>

  <footer class="my-5 pt-5 text-muted text-center text-small">
    <p class="mb-1">Just hostin' wholesome content</p>
    <ul class="list-inline">
      <li class="list-inline-item"><a href="/meme/">Memes</a></li>
    </ul>
  </footer>
</div>
</body>
</html>
`


const HTML_LINE_ITEM = (link, basename, size, uploaded, action) => {
    let icon
    if(link === "..") {
        icon = "arrow-90deg-up"
    }
    else if(action === "folder") {
        icon = "folder"
    }
    else if(/\.(jpe?g|png|bmp|tiff?|gif|webp|tga|cr2|nef|ico)$/i.test(basename)) {
        icon = "file-image"
    }
    else if(/\.(pub|txt|ini|cfg|css|js)$/i.test(basename)) {
        icon = "file-text"
    }
    else if(/\.(mp4|mkv|wmv|flv|hls|ogv|avi)$/i.test(basename)) {
        icon = "file-play"
    }
    else if(/\.(mp3|wma|flac|ogg|aac|m4a)$/i.test(basename)) {
        icon = "file-music"
    }
    else if(/\.(zip|tgz|gz|tar|7z|rar|xz)$/i.test(basename)) {
        icon = "file-zip"
    }
    else {
        icon = "file"
    }
    return `
<tr>
    <th scope='row'><a href='${link}'><i class='bi bi-${icon}'></i> ${basename}</a></th>
    <td>${size}</td>
    <td class='date-field'>${uploaded}</td>
</tr>
`
}
