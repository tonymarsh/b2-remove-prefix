import {
    B2_LIST_FILE_NAMES_ENDPOINT,
    CACHE_DIR_SECONDS,
    HTML_CONTENT_TYPE,
    KV_CONFIG_KEY,
} from './constants'
import { rewriteErrorResponse } from './error_handling'


/**
 * Given a URL that ends in a slash (/), list files in the bucket that begin with
 * that prefix.
 *
 * @param {Request} request the user's request for a URL that ends in a slash
 * @param {object} b2 the b2config object
 * @returns {Promise<Response|Response>} an HTML page listing files and folders
 */
async function getB2Directory(request, b2) {
    console.log("getB2Directory...")

    const url = new URL(b2.data.apiUrl)
    url.pathname = B2_LIST_FILE_NAMES_ENDPOINT
    const requestedUrl = new URL(request.url)
    console.log(`requestedUrl.pathname = ${requestedUrl.pathname}`)
    const prefix = requestedUrl.pathname.substring(1)  // chop off first / character
    console.log(`prefix = ${prefix}`)

    const requestBody = {
        bucketId: b2.data.bucketId,
        maxFileCount: 10000,
        prefix: prefix,
        delimiter: "/"
    }

    const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
            "Authorization": b2.data.authorizationToken,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody)
    })

    if(!response.ok) {
        return rewriteErrorResponse(request, response)
    }
    const htmlResponse = await convertListFileNamesToHTML(request, response)
    const cacheControl = `public, immutable, max-age=${CACHE_DIR_SECONDS}`
    const expires = new Date(Date.now() + CACHE_DIR_SECONDS * 1000).toUTCString()

    htmlResponse.headers.set("Cache-Control", cacheControl)
    htmlResponse.headers.set("Expires", expires)
    return htmlResponse
}

/**
 * Converts the JSON returned from B2's b2_list_file_names endpoint into an HTML
 * list page of files and "folders".
 *
 * @param {Request} request the user's request
 * @param {Response} response the B2 response to our b2_list_file_names call
 * @returns {Promise<Response|Response>} an HTML page listing the files/folders
 */
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

    let html = HTML_FILE_LIST(currentDir, fullPath, listings)
    return new Response(html, {
        status: 200,
        statusText: "OK",
        headers: {
            "Content-Type": HTML_CONTENT_TYPE,
        }
    })
}


/**
 * Given a file object's JSON returned from B2's b2_list_file_names endpoint,
 * returns a row for an HTML table as defined by the HTML_LINE_ITEM template.
 *
 * @param file
 * @param prefixLength
 * @returns {string}
 */
function convertFileInfoJsonToHTML(file, prefixLength) {
    let basename = file.fileName.substring(prefixLength)
    let dateStr = "", size = ""
    if(file.action !== "folder") {
        let ts = new Date(file.uploadTimestamp)
        dateStr = ts.toUTCString()
        size = getHumanReadableFileSize(file.contentLength)
    }

    return HTML_LINE_ITEM(basename, basename, size, dateStr, file.action)
}


/**
 * Given a number of Bytes, return a more human-readable SI Unit rounded to
 * the nearest 1/10 (Mebibyte or less) or 1/100 (Gibibyte and up). Less than
 * 4 KiB will return the same number with a "B" appended to the end.
 *
 * The return is a string of the number with the unit it was converted to.
 * i.e. 4404019 will return "4.2 MiB", 5001708 will return "4.77 GiB", etc.
 *
 * @param numBytes the number to be converted
 * @returns {string} the rounded number with the SI unit appended to the end
 */
function getHumanReadableFileSize(numBytes) {
    if(numBytes > 1099511627776) {  // 1 TiB
        numBytes = (numBytes / 1099511627776).toFixed(2)
    }
    else if(numBytes > 1073741824) {  // 1 GiB
        numBytes = (numBytes / 1073741824).toFixed(2)
        numBytes = `${numBytes} GiB`
    }
    else if(numBytes > 1048576) {  // 1 MiB
        numBytes = (numBytes / 1048576).toFixed(1)
        numBytes = `${numBytes} MiB`
    }
    else if(numBytes > 4096) {  // 4 KiB
        numBytes = (numBytes / 1024).toFixed(1)
        numBytes = `${numBytes} KiB`
    }
    else {
        numBytes = `${numBytes} B`
    }

    return numBytes
}

/**
 * Full HTML Template for the listing pages.
 *
 * @param currentDir the name of the folder we're currently on
 * @param fullPath the full path to the folder we're currently on
 * @param listings an array of HTML_LINE_ITEM items
 * @returns {string} an HTML template for the listing pages
 */
const HTML_FILE_LIST = (currentDir, fullPath, listings) => `<!doctype html>
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

/**
 * HTML table row template for file/folders listings.
 *
 * Represents one row, and therefore one file/folder on the table of
 * files/folders in our current directory.
 *
 * @param link what the item will link to when clicked (changes href attribute)
 * @param basename the file name to display
 * @param size the value of the Content-Length header sent by the
 * @param uploaded the timestamp of when the file was uploaded to Backblaze
 * @param action In B2 the action field is 'folder' for folders.
 * @returns {string} the HTML template with variables filled in
 * @constructor
 */
const HTML_LINE_ITEM = (link, basename, size, uploaded, action) => {
    let icon
    if (link === "..") {
        icon = "arrow-90deg-up"
    } else if (action === "folder") {
        icon = "folder"
    } else if (/\.(jpe?g|png|bmp|tiff?|gif|webp|tga|cr2|nef|ico)$/i.test(basename)) {
        icon = "file-image"
    } else if (/\.(pub|txt|ini|cfg|css|js)$/i.test(basename)) {
        icon = "file-text"
    } else if (/\.(mp4|mkv|wmv|flv|hls|ogv|avi)$/i.test(basename)) {
        icon = "file-play"
    } else if (/\.(mp3|wma|flac|ogg|aac|m4a)$/i.test(basename)) {
        icon = "file-music"
    } else if (/\.(zip|tgz|gz|tar|7z|rar|xz)$/i.test(basename)) {
        icon = "file-zip"
    } else {
        icon = "file"
    }

    return TEMPLATE_HTML_LINE_ITEM(link, basename, size, uploaded, icon)
}

const TEMPLATE_HTML_LINE_ITEM = (link, basename, size, uploaded, icon) => `
<tr>
    <th scope='row'>
        <a href='${link}'><i class='bi bi-${icon}'></i> ${basename}</a>
    </th>
    <td>${size}</td>
    <td class='date-field'>${uploaded}</td>
</tr>
`

export default getB2Directory
