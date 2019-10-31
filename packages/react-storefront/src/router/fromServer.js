/**
 * @license
 * Copyright © 2017-2018 Moov Corporation.  All rights reserved.
 */
import { fetchLatest, StaleResponseError } from '../fetchLatest'
import { abortPrefetches, resumePrefetches, isServiceWorkerReady } from './serviceWorker'
import {
  HANDLER,
  RESPONSE_TYPE,
  SURROGATE_KEY,
  REACT_STOREFRONT,
  API_VERSION,
  CLIENT_IF
} from './headers'
import getAPIVersion from './getAPIVersion'

let doFetch

/**
 * Fetch's state as json from the specified url
 * @private
 * @param {String} url The url to fetch
 * @param {Object} options
 * @param {String} options.cache Set to "force-cache" to cache the response in the service worker.  Omit to skip the service worker cache.
 * @param {Object} originalResponse Response object/context which can be modified on the client
 * @return {Object} A state patch
 */
export async function fetch(url, { cache = 'default', onlyHit = false } = {}, originalResponse) {
  abortPrefetches()
  doFetch = doFetch || fetchLatest(require('isomorphic-unfetch'))

  const { href } = location

  const headers = {
    [REACT_STOREFRONT]: 'true', // allows back end handlers to quickly identify PWA API requests,
    [API_VERSION]: getAPIVersion() // needed for the service worker to determine the correct runtime cache name and ensure that we're not getting a cached response from a previous api version
  }

  if (onlyHit) {
    headers[CLIENT_IF] = 'cache-hit'
  }

  try {
    const result = await doFetch(url, {
      cache: cache || 'default',
      credentials: 'include',
      headers
    }).then(response => {
      const { redirected, url } = response

      if (redirected) {
        redirectTo(url)
        // This allows downstream event handlers to know if a response was redirected
        if (originalResponse) {
          originalResponse.redirected = true
        }
      } else {
        resumePrefetches()

        if (response.status === 204) {
          return null
        } else {
          return response.json()
        }
      }
    })

    if (result != null && location.href === href) {
      // Make sure the user hasn't changed the page since the request was sent.
      // If they have the response is stale and shouldn't be used.
      // We can get here when switching back to a page that is cached in the DOM by Pages
      return { loading: false, ...result }
    }
  } catch (e) {
    if (StaleResponseError.is(e)) {
      return null
    } else {
      throw e
    }
  }
}

/**
 * Handles a redirect response.  Will do a client side navigation if the URL has the same hostname as the app, otherwise will
 * reload the page.
 * @private
 * @param {String} url
 */
function redirectTo(url) {
  if (url) {
    const parsed = new URL(url)
    const { history } = window.moov

    if (parsed.hostname === window.location.hostname) {
      history.push(parsed.pathname + parsed.search)
    } else {
      window.location.assign(url)
    }
  } else {
    throw new Error('Received a redirect without a location header.')
  }
}

/**
 * Creates a handler that fetches data from the server.
 *
 * The `handlerPath` should point to a module that exports a function that takes params, request, and response,
 * and returns an object that should be applied to the app state.  For example:
 *
 * ```js
 * // routes.js
 * router.get('/p/:id'
 *   fromServer('./product/product-handler')
 * )
 *
 * // product/product-handler.js
 * export default function productHandler(params, request, response) {
 *   return fetchFromUpstreamApi(`/products/${params.id}`)
 *     .then(res => res.json())
 *     .then(productData => ({ // the shape of this object should match your AppModel
 *       page: 'Product',
 *       product: productData
 *     }))
 * }
 * ```
 *
 * When the request path ends in ".json", the json response will be returned verbatim.  In all other cases, server-side rendered HTML
 * will be returned.
 *
 * You can also send a verbatim string response using `response.send(body)`.  For example:
 *
 * ```js
 * // routes.js
 * router.get('/my-api'
 *   fromServer('./my-api-handler')
 * )
 *
 * // my-api-handler.js
 * export default function myApiHandler(params, request, response) {
 *   response
 *     .set('content-type', response.JSON)
 *     .send(JSON.stringify({ foo: 'bar' }))
 * }
 * ```
 *
 * When `response.send()` is called in a handler, react-storefront will never perform server-side rendering.
 *
 * @param {String} handlerPath The path to the module that exports a handler function that returns
 *  state to apply to the app state tree.  The shape of the returned object should match your `AppModel`.
 * @param {Function} getURL An optional function that returns the back end url to call when fetching.  You only need
 *  to specify this if you want to override the default URL.
 * @return {Function}
 */
export default function fromServer(handlerPath, getURL) {
  if (handlerPath == null) {
    throw new Error(
      'You must provide a path to a handler in fromServer().  Please check your routes.'
    )
  }

  /**
   * Creates the URL for fetching json from the server, using `getURL` if provided,
   * allowing the user to override the URL convention.
   * @private
   */
  function createURL() {
    const url = `${location.pathname}.json${location.search}`
    return getURL ? getURL(url) : url
  }

  return {
    type: 'fromServer',
    runOn: {
      server: true,
      client: true // fromServer handlers run on the client too - we make an ajax request to get the state from the server
    },
    async getCachedResponse(response) {
      if (!isServiceWorkerReady()) return null
      return await fetch(createURL(), { cache: response.clientCache, onlyHit: true })
    },
    async fn(params, request, response) {
      if (typeof handlerPath === 'string') {
        // handler path has not been transpiled, fetch the data from the server and return the result.
        return fetch(createURL(), { cache: response.clientCache }, response)
      } else {
        // indicate handler path and asset class in a response header so we can track it in logs
        response.set(HANDLER, handlerPath.path)
        response.set(RESPONSE_TYPE, request.path.endsWith('.json') ? 'json' : 'ssr')

        // use the handler path as the surrogate cache key if one has not already been set by cache#surrogateKey
        if (!response.get(SURROGATE_KEY)) {
          response.set(SURROGATE_KEY, handlerPath.path)
        }

        // handler path has been transpiled to a function
        return handlerPath(params, request, response)
      }
    }
  }
}
