/**
 * @license
 * Copyright © 2017-2018 Moov Corporation.  All rights reserved.
 */
import React, { Component, Fragment } from 'react'
import { inject, observer, Provider } from 'mobx-react'
import { Helmet } from 'react-helmet'
import withStyles from '@material-ui/core/styles/withStyles'
import CssBaseline from '@material-ui/core/CssBaseline'
import { canUseClientSideNavigation } from './utils/url'
import delegate from 'delegate'
import { cache } from './router/serviceWorker'
import { isSafari } from './utils/browser'
import { connectReduxDevtools } from 'mst-middlewares'
import AppContext from './AppContext'
import ErrorBoundary from './ErrorBoundary'

/**
 * @private
 * Internal PWA root used when launching the app.  Do not use this class directly
 */
export const styles = theme => ({
  '@global': {
    html: {
      touchAction: 'manipulation'
    },
    'body.moov-modal': {
      overflow: 'hidden',
      position: 'fixed',
      maxWidth: '100vw',
      maxHeight: '100vh'
    },
    'body.moov-blur #root': {
      filter: 'blur(5px)',
      transition: `filter ${theme.transitions.duration.enteringScreen}ms`
    }
  }
})

@withStyles(styles)
@inject(({ app, history, router }) => ({ app, history, router, amp: app.amp }))
@observer
export default class PWA extends Component {
  _nextId = 0

  constructor({ app, history, router, errorReporter }) {
    super()
    this.recordStateOnChange(history)
    this.appContextValue = { app, history, router, errorReporter }
  }

  recordStateOnChange(history) {
    for (let method of ['push', 'go', 'goBack', 'goForward']) {
      const original = history[method]

      history[method] = (...args) => {
        this.recordState()
        original.call(history, ...args)
      }
    }
  }

  render() {
    const { amp, app, errorReporter } = this.props

    // This line is needed to ensure that the app rerenders and scrolls to the top when the URL changes
    // Note that we should *not* read app.scrollResetPending here, as it will cause the app to scroll
    // to the top before the page is rerendered
    const { uri } = app

    return (
      <AppContext.Provider value={this.appContextValue}>
        <Provider nextId={this.nextId} errorReporter={errorReporter}>
          <ErrorBoundary onError={errorReporter}>
            <Fragment>
              <CssBaseline />
              <Helmet>
                <html lang="en" />
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width" />
                <meta name="theme-color" content="#000000" />
                {app.description ? <meta name="description" content={app.description} /> : null}
                {app.canonicalURL ? <link rel="canonical" href={app.canonicalURL} /> : null}
                {/* crossorigin="use-credentials" is needed when the site is password protected by basic auth*/}
                <link rel="manifest" href="/manifest.json" crossorigin="use-credentials" />
                {app.title ? <title>{app.title}</title> : null}
              </Helmet>
              {amp && (
                <Helmet>
                  <script async src="https://cdn.ampproject.org/v0.js" />
                  <script
                    async
                    custom-element="amp-install-serviceworker"
                    src="https://cdn.ampproject.org/v0/amp-install-serviceworker-0.1.js"
                  />
                </Helmet>
              )}
              {amp && (
                <amp-install-serviceworker
                  src={`${app.location.urlBase}/service-worker.js`}
                  data-iframe-src={`${app.location.urlBase}/pwa/install-service-worker.html`}
                  layout="nodisplay"
                />
              )}
              {this.props.children}
            </Fragment>
          </ErrorBoundary>
        </Provider>
      </AppContext.Provider>
    )
  }

  nextId = () => {
    return this._nextId++
  }

  onBeforeRouteChange = ({ action }) => {
    // We'll check this to determine if the page should be reset after the next render
    // this ensures that the scroll reset doesn't happen until the new page is rendered.
    // Otherwise we would see the current page scroll to the top and after some delay, the new
    // page would render
    if (action === 'PUSH') {
      this.props.app.setScrollResetPending(true)
    }
  }

  componentDidMount() {
    const { router, app, history } = this.props

    if (router) {
      router.watch(history, app.applyState)
      router.on('before', this.onBeforeRouteChange)
    }

    // scroll to the top and close the when the router runs a PWA route
    this.watchLinkClicks()

    // put os class on body for platform-specific styling
    this.addDeviceClassesToBody()

    // set initial offline status
    app.setOffline(!navigator.onLine)

    window.addEventListener('online', () => {
      app.setOffline(false)
      // Fetch fresh page data since offline version may not be correct
      if (router) {
        router.fetchFreshState(document.location).then(app.applyState)
      }
    })

    window.addEventListener('offline', () => {
      app.setOffline(true)
    })

    // Fetching new app state for offline page
    if (!navigator.onLine && app.page === null) {
      router.fetchFreshState(document.location).then(state => {
        state.offline = true
        app.applyState(state)
      })
    }

    // only cache app shell and page if online
    if (navigator.onLine) {
      // cache the app shell so that we can load pages when offline when we don't have a cached SSR response
      if (router && router.isAppShellConfigured()) {
        cache('/.app-shell')
      }

      // cache the initial page HTML and json
      const path = app.location.pathname + app.location.search
      cache(path + '.json', window.initialRouteData)
      cache(path, `<!DOCTYPE html>\n${document.documentElement.outerHTML}`)
    }

    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
      connectReduxDevtools(require('remotedev'), app)
    }
  }

  componentDidUpdate() {
    const { app } = this.props

    if (app.scrollResetPending) {
      this.resetPage()
      app.setScrollResetPending(false)
    }
  }

  componentWillUnmount() {
    if (this.props.router) {
      this.props.router.removeListener('before', this.onBeforeRouteChange)
    }
  }

  /**
   * Records the app state in the history state.
   * This makes restoring the page when going back really fast.
   */
  recordState() {
    const { history, app } = this.props
    const { pathname, search, hash = '' } = history.location

    try {
      history.replace(pathname + hash + search, app.toJSON())
    } catch (e) {
      // If recording the app state fails, clear out the history state
      // we don't want the app restoring a stale state if the user navigates back/forward.
      // Browsers impose a limit on the size of the state object.  Firefox's is the smallest
      // at 640kB, IE11 is 1MB, and Chrome is at least 10MB. Exceeding this limit is the most
      // likely reason for history.replace to fail.
      history.replace(pathname + hash + search, null)
      console.warn(
        'Could not record app state in history.  Will fall back to fetching state from the server when navigating back and forward.'
      )
    }
  }

  /**
   * Adds a css class corresponding to the browser to the body element
   * @private
   */
  addDeviceClassesToBody() {
    if (isSafari()) {
      document.body.classList.add('moov-safari')
    }
  }

  /**
   * Returns true if client-side navigation should be forced, otherwise false
   * @param {HTMLElement} linkEl
   * @return {Boolean}
   */
  shouldNavigateOnClient(linkEl) {
    const href = linkEl.getAttribute('href')
    const linkTarget = linkEl.getAttribute('target')

    // false if the element is not a link
    if (linkEl.tagName.toLowerCase() !== 'a') return false

    // false if the link was rendered by react-storefront/Link - it will handle nav on its own
    if (linkEl.getAttribute('data-moov-link') === 'on') return false

    // false if link has data-reload="on|true"
    if (['true', 'on'].indexOf(linkEl.getAttribute('data-reload')) !== -1) return false

    // false for links with a target other than self
    if (linkTarget && linkTarget !== '_self') return false

    return canUseClientSideNavigation(href, this.props.router)
  }

  /**
   * Watches for clicks on all links and forces client-side navigation if the domain is the same.
   * This behavior can be overridden by adding data-reload="on" to any link
   */
  watchLinkClicks() {
    // capture click events
    delegate('a', 'click', e => {
      const { delegateTarget } = e

      if (this.shouldNavigateOnClient(delegateTarget)) {
        // don't reload the page
        e.preventDefault()

        // instead do the navigation client-side using the history API
        this.props.history.push(delegateTarget.getAttribute('href'))
      }
    })
  }

  /**
   * Resets the scroll position and closes the main menu.
   */
  resetPage = () => {
    window.scrollTo(0, 0)
    this.props.app.menu.close()
  }
}
