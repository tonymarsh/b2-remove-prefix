// MIME Types for Content-Type HTTP header
export const PLAIN_TEXT_CONTENT_TYPE = "text/plain;charset=utf-8"
export const HTML_CONTENT_TYPE = "text/html;charset=utf-8"

/**
 * List file names in a given bucket, optionally with a prefix.
 * https://www.backblaze.com/b2/docs/b2_list_file_names.html
 *
 * @type {string}
 */
export const B2_LIST_FILE_NAMES_ENDPOINT = "/b2api/v2/b2_list_file_names"


// Cache-Control header constants
/**
 * Default cache age of most responses
 *
 * @type {number}
 */
export const CACHE_AGE_SECONDS = 604800  // 1 week in seconds

/**
 * How long to cache a directory listing page
 * @type {number}
 */
export const CACHE_DIR_SECONDS = 30

/**
 * How long error pages should be cached for
 *
 * @type {number}
 */
export const CACHE_ERRORS_SECONDS = 10
