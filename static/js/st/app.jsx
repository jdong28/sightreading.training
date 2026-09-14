import App from "st/components/app"
import {ENABLE_SERVICE_WORKER} from "st/globals"
import {initStorage} from "st/storage"

import * as React from "react"

import { createRoot } from "react-dom/client";

let currentSession = null;

let root = null

function getRoot() {
  root ||= createRoot(document.getElementById("page"));
  return root;
}

export function getSession() {
  return currentSession;
}

export function init(session) {
  currentSession = session || {}

  // pages read the local store synchronously, so it's ready before they
  // render. initStorage falls back to memory rather than rejecting
  initStorage().catch(err => {
    console.error("Couldn't initialize the local store", err)
  }).then(() => {
    getRoot().render(<App />)
  })

  installServiceWorker(session.cacheBuster)
}

export function installServiceWorker(timestamp) {
  if (!ENABLE_SERVICE_WORKER) {
    console.warn("Service worker not enabled")
    return
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`/sw.js?${timestamp}`).then(function(registration) {
      console.log("Service worker registered", registration.scope)
    }, function(err) {
      console.error("Service worker failed to register", err)
    })
  }
}
