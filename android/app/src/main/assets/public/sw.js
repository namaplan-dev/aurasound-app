/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "7fdee835dca770ed5aaa1a32ffcf5a27"
  }, {
    "url": "pwa-512x512.png",
    "revision": "088303300825765e272aff1be3d370ec"
  }, {
    "url": "pwa-192x192.png",
    "revision": "5cae7ab2a0b45e84463550b878484351"
  }, {
    "url": "index.html",
    "revision": "a84f0d84c7d4cddc563962ae266bbf29"
  }, {
    "url": "icon.svg",
    "revision": "925aa20d667bace57b00f0c1d480f656"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "1f7b36f9dbb267a9cc5b35885f3285b0"
  }, {
    "url": "assets/workbox-window.prod.es5-Bd17z0YL.js",
    "revision": null
  }, {
    "url": "assets/index-aNOr_chL.css",
    "revision": null
  }, {
    "url": "assets/index-CZIhuq0G.js",
    "revision": null
  }, {
    "url": "assets/album_nocturne_vinyl_1794587934959-HGvPbLOe.jpg",
    "revision": null
  }, {
    "url": "assets/album_jazz_quartet_1794587935839-CvBPV2-0.jpg",
    "revision": null
  }, {
    "url": "assets/album_baltic_ambient_1794587935576-D8VKDs7u.jpg",
    "revision": null
  }, {
    "url": "assets/album_analog_synth_1794587936966-rJPT9Yof.jpg",
    "revision": null
  }, {
    "url": "assets/album_acoustic_atrium_1794587935664-9FDoCyfz.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261113_221930_Chrome_ed820bab.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261113_214226_AuraSound_970e2e62.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261113_205805_Chrome_a7565d65.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261113_205329_Chrome_ae335ef0.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261113_204628_Chrome_b80a0b4f.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261113_203441_Chrome_ad9a5490.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261113_193627_Chrome_92ac94d2.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261113_192339_Chrome_5819f224.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/Screenshot_20261113_191804_Chrome_10fdb99f.jpg",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "1f7b36f9dbb267a9cc5b35885f3285b0"
  }, {
    "url": "icon.svg",
    "revision": "925aa20d667bace57b00f0c1d480f656"
  }, {
    "url": "pwa-192x192.png",
    "revision": "5cae7ab2a0b45e84463550b878484351"
  }, {
    "url": "pwa-512x512.png",
    "revision": "088303300825765e272aff1be3d370ec"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "7fdee835dca770ed5aaa1a32ffcf5a27"
  }, {
    "url": "manifest.webmanifest",
    "revision": "b4360d4b1e426231fa43e960bca0c0b4"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//]
  }));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
