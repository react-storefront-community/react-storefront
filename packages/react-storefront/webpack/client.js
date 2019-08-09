const path = require('path')
const StatsWriterPlugin = require('webpack-stats-plugin').StatsWriterPlugin
const WriteFilePlugin = require('write-file-webpack-plugin')
const CopyPlugin = require('copy-webpack-plugin')
const { GenerateSW } = require('workbox-webpack-plugin')
const { createLoaders, injectBuildTimestamp, createAliases } = require('./common')
const createOptimization = require('./optimization')
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
const HtmlWebpackPlugin = require('html-webpack-plugin')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const crypto = require('crypto')
const fs = require('fs')
const OEMConfigWriterPlugin = require('./plugins/oem-config-writer-plugin')

// We use this pattern to replace AMP modules with an empty function
// when building the application for the client, since AMP components
// will never be used client side.
const ampToExcludePattern = /react-storefront\/dist\/amp\/(.*).js/

module.exports = {
  /**
   * Generates a webpack config for the client development build
   * @param {String} root The path to the root of the project
   * @param {Object} options
   * @param {Object} options.entries Additional entries for adapt components
   * @param {Array}  options.additionalPlugins Additional plugins
   * @param {Object} options.workboxConfig A config object for InjectManifest from workbox-webpack-plugin.  See https://developers.google.com/web/tools/workbox/modules/workbox-webpack-plugin#configuration
   * @param {Number} options.prefetchRampUpTime The number of milliseconds from the time of the build before prefetching is ramped up to 100%
   * @param {Boolean} options.allowPrefetchThrottling Set to true allow the platform to return a 412 error when a prefetch request results in a cache miss
   * @param {Object} options.eslintConfig A config object for eslint
   * @param {Boolean} options.optimization Configuration for the webpack optimzation object
   * @param {Object} options.alias Aliases to apply to the webpack config
   * @return {Object} A webpack config
   */
  dev(
    root,
    {
      workboxConfig,
      entries,
      additionalPlugins = [],
      eslintConfig = require('./eslint-client'),
      prefetchRampUpTime = -5000, // compensate for the 5 minute buffer for deployments so that there is no ramp up time
      allowPrefetchThrottling = false,
      serveSSRFromCache = false,
      optimization,
      alias = {}
    } = {}
  ) {
    const dest = path.join(root, 'build', 'assets', 'pwa')

    alias = {
      ...alias,
      'react-storefront-stats': path.join(
        root,
        'node_modules',
        'react-storefront',
        'stats',
        'getStatsInDev'
      )
    }

    return () =>
      Object.assign(createClientConfig(root, { entries, alias }), {
        devtool: 'inline-cheap-module-source-map',
        mode: 'development',
        optimization: createOptimization({ overrides: optimization }),
        module: {
          rules: createLoaders(path.resolve(root, 'src'), {
            envName: 'development-client',
            eslintConfig
          })
        },
        plugins: [
          ...createPlugins(root, 'development'),
          new WriteFilePlugin(),
          new StatsWriterPlugin({
            filename: 'stats.json'
          }),
          ...additionalPlugins,
          ...createServiceWorkerPlugins({
            root,
            dest,
            workboxConfig: process.env.MOOV_SW ? workboxConfig : null,
            prefetchRampUpTime,
            allowPrefetchThrottling,
            serveSSRFromCache
          })
        ]
      })
  },

  /**
   * Generates a webpack config for the client production build
   * @param {String} root The path to the root of the project
   * @param {Object} options
   * @param {Object} options.entries Additional entries for adapt components
   * @param {Array}  options.additionalPlugins Additional plugins
   * @param {Object} options.workboxConfig A config object for InjectManifest from workbox-webpack-plugin.  See https://developers.google.com/web/tools/workbox/modules/workbox-webpack-plugin#configuration
   * @param {Number} options.prefetchRampUpTime The number of milliseconds from the time of the build before prefetching is ramped up to 100%
   * @param {Boolean} options.allowPrefetchThrottling Set to true allow the platform to return a 412 error when a prefetch request results in a cache miss
   * @param {Boolean} options.optimization Configuration for the webpack optimzation object
   * @param {Object} options.alias Aliases to apply to the webpack config
   * @return {Object} A webpack config
   */
  prod(
    root,
    {
      workboxConfig = {},
      additionalPlugins = [],
      entries,
      prefetchRampUpTime = 1000 * 60 * 20 /* 20 minutes */,
      allowPrefetchThrottling = false,
      serveSSRFromCache = false,
      optimization,
      alias = {},
      routesPath = null
    } = {}
  ) {
    const webpack = require(path.join(root, 'node_modules', 'webpack'))
    const dest = path.join(root, 'build', 'assets', 'pwa')

    alias = {
      ...alias,
      'react-storefront-stats': path.join(
        root,
        'node_modules',
        'react-storefront',
        'stats',
        'getStatsInDev'
      )
    }

    if (process.env.moov_analysis_report_path || process.env.ANALYZE === 'true') {
      additionalPlugins.push(
        new BundleAnalyzerPlugin({
          analyzerMode: 'static',
          reportFilename: process.env.MOOV_ANALYSIS_REPORT_PATH
        })
      )
    }

    return () =>
      Object.assign(createClientConfig(root, { entries, alias }), {
        mode: 'production',
        optimization: createOptimization({ production: true, overrides: optimization }),
        devtool: 'source-map',
        module: {
          rules: createLoaders(path.resolve(root, 'src'), { envName: 'production-client' })
        },
        plugins: [
          ...createPlugins(root, 'production'),
          new webpack.LoaderOptionsPlugin({
            minimize: true,
            debug: false
          }),
          new StatsWriterPlugin({
            filename: path.relative(dest, path.join(root, 'scripts', 'build', 'stats.json'))
          }),
          new webpack.NormalModuleReplacementPlugin(ampToExcludePattern, function(resource) {
            // Parse module name from request
            const moduleName = resource.request.match(ampToExcludePattern)[1]
            if (moduleName !== 'installServiceWorker') {
              // Empty module exists within the `amp` directory
              resource.request = resource.request.replace(moduleName, 'Empty')
            }
          }),
          ...additionalPlugins,
          ...createServiceWorkerPlugins({
            root,
            dest,
            workboxConfig,
            prefetchRampUpTime,
            allowPrefetchThrottling,
            serveSSRFromCache
          })
        ]
      })
  }
}

function createClientConfig(
  root,
  {
    // This is where the developer will add additional entries for adapt components.
    entries = {},
    alias = {}
  }
) {
  return {
    name: 'client',
    target: 'web',
    context: path.join(root, 'src'),
    entry: Object.assign(
      {
        main: ['./client.js'],
        installServiceWorker: path.join(
          root,
          'node_modules',
          'react-storefront',
          'amp',
          'installServiceWorker'
        )
      },
      entries
    ),
    resolve: {
      alias: Object.assign({}, createAliases(root), alias, {
        fetch: 'isomorphic-unfetch'
      })
    },
    output: {
      filename: '[name].[hash].js',
      chunkFilename: '[name].[hash].js',
      path: path.join(root, 'build', 'assets', 'pwa'),
      publicPath: '/pwa/',
      devtoolModuleFilenameTemplate: '[absolute-resource-path]'
    }
  }
}

function createPlugins(root, env) {
  const webpack = require(path.join(root, 'node_modules', 'webpack'))

  return [
    injectBuildTimestamp(),
    new CopyPlugin([
      {
        from: path.join(root, 'public'),
        to: path.join(root, 'build', 'assets')
      }
    ]),
    new CleanWebpackPlugin({
      verbose: false
    }),
    new webpack.DefinePlugin({
      'process.env.MOOV_RUNTIME': JSON.stringify('client'),
      'process.env.NODE_ENV': JSON.stringify(env),
      'process.env.MOOV_ENV': JSON.stringify(env),
      'process.env.PUBLIC_URL': JSON.stringify('') // needed for registerServiceWorker.js
    }),
    new HtmlWebpackPlugin({
      filename: 'install-service-worker.html',
      title: 'Installing Service Worker...',
      chunks: ['bootstrap', 'installServiceWorker']
    })
  ]
}

function createServiceWorkerPlugins({
  root,
  dest,
  workboxConfig,
  prefetchRampUpTime,
  allowPrefetchThrottling = false,
  serveSSRFromCache = false
}) {
  if (!workboxConfig) return []

  let deployTime = new Date().getTime()

  if (allowPrefetchThrottling) {
    // pre fetch ramp up is not needed if we're allowing prefetch throttling
    prefetchRampUpTime = 0
  } else {
    deployTime += 5 * 1000 * 60 // add 5 minutes to give the build time to deploy
  }

  const swBootstrap = path.join(__dirname, '..', 'service-worker', 'bootstrap.js')

  const swBootstrapCode = fs
    .readFileSync(swBootstrap, 'utf8')
    .replace('{{version}}', deployTime)
    .replace('{{deployTime}}', deployTime)
    .replace('{{prefetchRampUpTime}}', prefetchRampUpTime)
    .replace('{{allowPrefetchThrottling}}', allowPrefetchThrottling)
    .replace('{{serveSSRFromCache}}', serveSSRFromCache)

  const swHash = crypto
    .createHash('md5')
    .update(swBootstrapCode)
    .digest('hex')

  const swBootstrapOutputFile = `serviceWorkerBootstrap.${swHash}.js`

  return [
    new CopyPlugin([
      {
        from: swBootstrap,
        to: path.join(root, 'build', 'assets', 'pwa', swBootstrapOutputFile),
        transform: () => swBootstrapCode
      }
    ]),
    new GenerateSW(
      Object.assign(
        {
          swDest: path.join(dest, '..', 'service-worker.js'),
          importScripts: [`/pwa/${swBootstrapOutputFile}`],
          clientsClaim: true,
          skipWaiting: true,
          exclude: [
            /stats\.json/,
            /\.DS_Store/,
            /robots\.txt/,
            /manifest\.json/,
            /icons\//,
            /\.js\.map/
          ]
        },
        workboxConfig
      )
    )
  ]
}
