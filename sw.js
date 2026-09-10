const CACHE_NAME = "campusone-ngc-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./logo.png"
];

importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBMpUBtJf4C6tP2uv3BeC3OSLNLRV1amhg",
  authDomain: "campusone-a53a5.firebaseapp.com",
  projectId: "campusone-a53a5",
  storageBucket: "campusone-a53a5.firebasestorage.app",
  messagingSenderId: "157438818912",
  appId: "1:157438818912:web:9d1296b109299ac702a105",
  measurementId: "G-8N6VSYMS24"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};

  const title =
    notification.title ||
    payload.data?.title ||
    "CampusOne NGC";

  const options = {
    body:
      notification.body ||
      payload.data?.body ||
      "New notification",

    icon:
      notification.icon ||
      "./logo.png",

    badge: "./logo.png",

    image:
      notification.image ||
      payload.data?.image ||
      undefined,

    data: {
      url:
        notification.click_action ||
        payload.data?.url ||
        "./"
    },

    tag:
      payload.data?.notificationId ||
      "campusone-notification"
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url =
    event.notification?.data?.url ||
    "./";

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true
      })
      .then((clientList) => {

        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(url).catch(() => {});
            return client.focus();
          }
        }

        return clients.openWindow(url);
      })
  );
});

self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {

  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {

  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches
      .match(event.request)
      .then((cached) => {

        if (cached) {
          return cached;
        }

        return fetch(event.request)
          .then((response) => {

            const copy = response.clone();

            caches
              .open(CACHE_NAME)
              .then((cache) =>
                cache.put(event.request, copy)
              )
              .catch(() => {});

            return response;
          })
          .catch(() =>
            caches.match("./index.html")
          );
      })
  );
});
