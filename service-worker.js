// @ts-check
import * as Automerge from "@automerge/automerge/slim";
import { Repo, isValidAutomergeUrl } from "@automerge/automerge-repo/slim";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { MessageChannelNetworkAdapter } from "@automerge/automerge-repo-network-messagechannel";

/**
 * This file is not built using the standard Vite toolchain, it is built by the
 * build-service-worker.js script which is invoked by `yarn run build`. In
 * order to provide a good development experience there is also a vite plugin
 * which builds the file using esbuild in development configured in
 * vite.config.ts.
 *
 * Why?! You exclaim in horror. The problem is that Firefox does not support
 * ES modules in service workers, but Vite doesn't give us any way of using a
 * different build in service-worker.js to elsewhere. Hence, this hack, which
 * allows us to specify an IIFE output for just service-worker.js.
 *
 * Now, this means that we can't use a bunch of useful vite functionality, most
 * importantly we can't use the `?url` suffix on an import. This is a shame
 * because due to the fact that we can't use ES modules here, we need some way
 * of getting the URL to the `.wasm` file which we use to initialize Automerge.
 * As a workaround, we wait for the host page to send us a message with the URL
 * for the wasm blob in it.
 */

const CACHE_NAME = "v6";

let PEER_ID = `service-worker-${Math.round(Math.random() * 1000000)}`;

/* Config is passed by the client in the init message
{
  wasmBlobUrl: string  // url to the wasm blob
  backupSync: boolean  // weather or not the experimental sync server should be enabled
  peerIdPrefix: string // prefix that is added to peer to make it easier to find own messages in server log
}*/
let resolveConfig;
const config = new Promise((resolve) => {
  resolveConfig = resolve;
});

const repo = new Promise(async (resolve) => {
  const { wasmBlobUrl, backupSync, peerIdPrefix } = await config;

  await Automerge.initializeWasm(wasmBlobUrl);

  if (peerIdPrefix) {
    PEER_ID = `${peerIdPrefix}-${PEER_ID}`;
  }

  const repo = new Repo({
    storage: new IndexedDBStorageAdapter(),
    network: [
      new BrowserWebSocketClientAdapter("wss://sync.automerge.org"),
    ].concat(
      backupSync
        ? [
            new BrowserWebSocketClientAdapter(
              "wss://jacquardsync.memoryandthought.me"
            ),
          ]
        : []
    ),
    peerId: PEER_ID,
    sharePolicy: async (peerId) => peerId.includes("storage-server"),
    enableRemoteHeadsGossiping: true,
  });

  // Put the repo on the global context for interactive use
  self.repo = repo;
  self.Automerge = Automerge;

  resolve(repo);
});

function sendMessageToClients(message) {
  clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage(message);
    });
  });
}

// When the service worker restarts, tell all clients to re-establish the message channel
sendMessageToClients({ type: "SERVICE_WORKER_RESTARTED" });

self.addEventListener("install", () => {
  /* We skip waiting which means the service worker immediately takes over once it's installed
   * Any existing tab that is connected to a previous worker gets sent an "controllerchange" event to switch over to the new service worker
   */
  self.skipWaiting();
});

self.addEventListener("message", async (event) => {
  console.log(`${PEER_ID}: Client messaged`, event.data);

  switch (event.data.type) {
    case "PING":
      // don't do anything, message is only needed to keep service worker running
      return;

    case "INIT":
      // load config and connect with client through message channel
      // if config is already loaded the new config is ignored
      const clientPort = event.ports[0];
      resolveConfig(event.data.config);

      (await repo).networkSubsystem.addNetworkAdapter(
        new MessageChannelNetworkAdapter(clientPort, { useWeakRef: true })
      );
  }
});

function addSyncServer(url) {
  repo.then((repo) =>
    repo.networkSubsystem.addNetworkAdapter(
      new BrowserWebSocketClientAdapter(url)
    )
  );
}
self.addSyncServer = addSyncServer;

async function clearOldCaches() {
  const cacheWhitelist = [CACHE_NAME];
  const cacheNames = await caches.keys();
  const deletePromises = cacheNames.map((cacheName) => {
    if (!cacheWhitelist.includes(cacheName)) {
      return caches.delete(cacheName);
    }
  });
  await Promise.all(deletePromises);
}

self.addEventListener("activate", async (event) => {
  console.log(`${PEER_ID}: Activating service worker.`);
  await clearOldCaches();
  clients.claim();
});

const ASSETS_REQUEST_URL_REGEX =
  /^https?:\/\/automerge\/(?<docId>[a-zA-Z0-9]+)(\/(?<path>.*))?$/;

self.addEventListener("fetch", async (event) => {
  const url = new URL(event.request.url);
  const match = event.request.url.match(ASSETS_REQUEST_URL_REGEX);

  if (match) {
    const { docId, path } = match.groups;

    const automergeUrl = `automerge:${docId}`;
    if (!isValidAutomergeUrl(automergeUrl)) {
      event.respondWith(
        new Response(`Invalid document id ${docId}`, {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        })
      );
      return;
    }

    event.respondWith(
      (async () => {
        const handle = (await repo).find(automergeUrl);
        await handle.whenReady();
        const doc = await handle.doc();

        if (!doc) {
          return new Response(
            `Document unavailable.\n${automergeUrl}: ${handle.state}`,
            {
              status: 500,
              headers: { "Content-Type": "text/plain" },
            }
          );
        }

        const parts = decodeURI(path).split("/");
        const file = parts.reduce((acc, curr) => acc?.[curr], doc);
        if (!file) {
          return new Response(
            `Not found\nObject path: ${path}\n${JSON.stringify(doc, null, 2)}`,
            {
              status: 404,
              headers: { "Content-Type": "text/plain" },
            }
          );
        }

        if (!file.contentType) {
          return new Response(
            `Invalid file entry.\n${
              assetsHandle.url
            }:\nfileEntry:${JSON.stringify(file)}`,
            {
              status: 404,
              headers: { "Content-Type": "text/plain" },
            }
          );
        }

        return new Response(file.contents, {
          headers: { "Content-Type": file.contentType },
        });
      })()
    );
  }
  // disable caching for now
  /* else if (
    import.meta.env.PROD &&
    event.request.method === "GET" &&
    url.origin === self.location.origin
  ) {
    event.respondWith(
      (async () => {
        const r = await caches.match(event.request);
        console.log(
          `[Service Worker] Fetching resource from cache: ${event.request.url}`
        );
        if (r) {
          return r;
        }
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        console.log(
          `[Service Worker] Caching new resource: ${event.request.url}`
        );
        cache.put(event.request, response.clone());
        return response;
      })()
    );
  } */
});
